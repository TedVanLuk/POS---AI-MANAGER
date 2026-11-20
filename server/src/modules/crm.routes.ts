import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { isoDate, parse, reason, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireDevice, requireUser, STAFF_ROLES, userOf, type Principal } from '../plugins/auth.js';
import { TABLES } from '../policy/handbook.js';
import { campaignResult, ERASED_FIELDS, exportCustomer, overview, planMessage, recognition, type Profile } from '../crm/core.js';
import { CHANNELS, inHoldout, inQuietHours, isOptOutReply, SEGMENTS, selectAudience, smsParts, TRIGGERS, type AudienceFilter, type Segment } from '../crm/engine.js';
import { normalizePhone } from '../crm/phone.js';
import { applyPlaybook, PLAYBOOKS } from '../crm/playbooks.js';
import {
  crmContext, findOrCreateGuest, loadProfiles, pointsBalance, recordVisit, redeem, runAutomations, sendPlanned, setConsent, toAutomation, toCustomer,
  toMessage, toPoints, toReservation, toVisit, venueRevenue, type Ctx,
} from '../crm/service.js';

const channel = z.enum(['sms', 'viber', 'email', 'messenger']);
const money = z.number().min(0).max(100_000_000);
const mmdd = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Birthday as MM-DD').nullable().optional();
const filter = z.object({
  segments: z.array(z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]])).optional(), tags: z.array(z.string().max(60)).optional(), tiers: z.array(z.string().max(60)).optional(),
  minVisits: z.number().int().min(0).optional(), maxVisits: z.number().int().min(0).optional(),
  minDaysSinceLastVisit: z.number().int().min(0).optional(), maxDaysSinceLastVisit: z.number().int().min(0).optional(),
  minSpend365: z.number().min(0).optional(), birthdayWithinDays: z.number().int().min(0).max(366).optional(), categories: z.array(z.string().max(60)).optional(),
}).strict();
const prefs = z.object({ drinks: z.string().max(200), food: z.string().max(200), seating: z.string().max(200), allergies: z.string().max(200), music: z.string().max(200), notes: z.string().max(2000) }).partial();
const guest = z.object({
  phone: z.string().max(30).nullable().optional(), firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(),
  email: z.email().max(200).nullable().optional().or(z.literal('')), birthday: mmdd, consentSms: z.boolean().optional(), referredByEmployeeId: uuid.nullable().optional(),
});

const summary = (p: Profile) => ({
  id: p.id, name: p.name, phoneDisplay: p.phoneDisplay, email: p.email, tier: p.tier, segment: p.segment, tags: p.tags, pointsBalance: p.pointsBalance,
  visits: p.stats.visits, spend: p.stats.spend, spend365: p.stats.spend365, avgSpend: p.stats.avgSpend, lastVisit: p.stats.lastVisit, daysSinceLastVisit: p.stats.daysSinceLastVisit,
  overdue: p.stats.overdue, marketable: p.marketable, birthday: p.birthday, daysToBirthday: p.daysToBirthday, erasedAt: p.erasedAt, source: p.source, createdAt: p.createdAt,
});
const empName = async (tenantId: string, ids: (string | null)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: schema.employees.id, f: schema.employees.firstName, l: schema.employees.lastName, dep: schema.employees.department }).from(schema.employees)
    .where(and(eq(schema.employees.tenantId, tenantId), inArray(schema.employees.id, list)));
  return new Map(rows.map((r) => [r.id, `${r.f} ${r.l}`.trim()]));
};
async function getCustomer(tenantId: string, id: string) {
  const [c] = await db.select().from(schema.crmCustomers).where(and(eq(schema.crmCustomers.tenantId, tenantId), eq(schema.crmCustomers.id, id)));
  if (!c) throw notFound('Guest');
  return c;
}
async function oneProfile(tenantId: string, id: string) {
  const data = await loadProfiles(tenantId);
  const p = data.profiles.find((x) => x.id === id);
  if (!p) throw notFound('Guest');
  return { ...data, p };
}

/** AI Marketing: guests, loyalty, reservations, campaigns and automations. */
export default async function crmRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  // ------------------------------------------------------------ settings & playbooks
  app.get('/api/crm/settings', staff, async (req) => {
    const ctx = await crmContext(userOf(req).tenantId);
    return {
      settings: ctx.settings, today: ctx.today, business: ctx.business, provider: config.smsProvider,
      playbooks: PLAYBOOKS.map((p) => ({ key: p.key, name: p.name, summary: p.summary, businessTypes: p.businessTypes, automations: p.automations.length })),
      tables: TABLES, segments: SEGMENTS, triggers: TRIGGERS,
    };
  });

  app.put('/api/crm/settings', admin, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({
      senderName: z.string().trim().min(3).max(11).regex(/^[A-Za-z0-9 .&-]+$/, 'Letters, digits, space . & - only').optional(),
      consentText: z.string().trim().min(20).max(600).optional(), holdoutPct: z.number().int().min(0).max(50).optional(), attributionDays: z.number().int().min(1).max(90).optional(),
      quietHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) }).optional(), dayStartHour: z.number().int().min(0).max(12).optional(),
      costPerSms: z.number().min(0).max(10).optional(), retentionDays: z.number().int().min(90).max(3650).optional(), categories: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
      loyalty: z.object({
        enabled: z.boolean(), name: z.string().trim().min(2).max(60),
        earn: z.discriminatedUnion('kind', [z.object({ kind: z.literal('spend'), pesosPerPoint: z.number().min(1).max(100_000) }), z.object({ kind: z.literal('visit'), points: z.number().int().min(1).max(100), minSpend: money })]),
        rewards: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/), name: z.string().trim().min(2).max(80), points: z.number().int().min(1), kind: z.enum(['amount_off', 'percent_off', 'free_item']), value: z.number().min(0), item: z.string().max(80).optional() })).max(20),
        welcomePoints: z.number().int().min(0).max(100_000), birthdayPoints: z.number().int().min(0).max(100_000), expiryDays: z.number().int().min(30).max(3650).nullable(),
      }).optional(),
      tiers: z.array(z.object({ name: z.string().trim().min(1).max(40), minSpend365: money, multiplier: z.number().min(1).max(5), perks: z.string().max(300) })).min(1).max(8).optional(),
      tagRules: z.array(z.object({ tag: z.string().trim().min(1).max(40), description: z.string().max(200), when: z.array(z.object({ field: z.string().max(60), op: z.enum(['gte', 'lte', 'eq']), value: z.number() })).min(1).max(5) })).max(40).optional(),
    }).strict(), req.body);
    const ctx = await crmContext(p.tenantId);
    const next = { ...ctx.settings, ...b };
    if (b.consentText && b.consentText !== ctx.settings.consentText) next.consentVersion = `v${(parseInt(ctx.settings.consentVersion.slice(1), 10) || 1) + 1}`;
    await db.update(schema.tenants).set({ settings: { ...ctx.tenant.settings, crm: next as never } }).where(eq(schema.tenants.id, p.tenantId));
    await audit(p, { entity: 'crm_settings', action: 'update', before: Object.fromEntries(Object.keys(b).map((k) => [k, ctx.settings[k as keyof typeof ctx.settings]])), after: b }, db, req.ip);
    return { settings: next };
  });

  app.post('/api/crm/playbooks/:key/apply', admin, async (req) => {
    const p = userOf(req);
    const key = (req.params as { key: string }).key;
    const ctx = await crmContext(p.tenantId);
    let applied;
    try { applied = applyPlaybook(ctx.settings, key); } catch { throw notFound('Playbook'); }
    await db.transaction(async (tx) => {
      await tx.update(schema.tenants).set({ settings: { ...ctx.tenant.settings, crm: applied.settings as never } }).where(eq(schema.tenants.id, p.tenantId));
      await tx.delete(schema.crmAutomations).where(eq(schema.crmAutomations.tenantId, p.tenantId));
      await tx.insert(schema.crmAutomations).values(applied.automations.map((a, i) => ({ tenantId: p.tenantId, key: a.key, name: a.name, trigger: a.trigger, enabled: a.enabled, channel: a.channel, days: a.days, filter: a.filter, template: a.template, bonusPoints: a.bonusPoints ?? null, sortOrder: i })));
      await audit(p, { entity: 'crm_settings', action: 'apply_playbook', after: { playbook: key } }, tx, req.ip);
    });
    return { settings: applied.settings, automations: applied.automations.length };
  });

  // ------------------------------------------------------------ dashboard
  app.get('/api/crm/overview', staff, async (req) => {
    const p = userOf(req);
    const d = await loadProfiles(p.tenantId);
    const from = DateTime.fromISO(d.today).minus({ days: 29 }).toISODate()!;
    return overview({ profiles: d.profiles, visits: d.rows.visits, messages: d.rows.messages, campaigns: d.rows.campaigns, settings: d.settings, today: d.today, venueRevenue: await venueRevenue(p.tenantId, d.tz, from, d.today) });
  });

  // ------------------------------------------------------------ guests
  app.get('/api/crm/customers', staff, async (req) => {
    const q = parse(z.object({ q: z.string().max(80).optional(), segment: z.string().optional(), tag: z.string().optional(), tier: z.string().optional(), sort: z.enum(['spend', 'recent', 'name', 'visits', 'points']).optional() }), req.query);
    const d = await loadProfiles(userOf(req).tenantId);
    const s = q.q?.trim().toLowerCase();
    const digits = s?.replace(/\D/g, '');
    let list = d.profiles.filter((p) => !p.erasedAt
      && (!s || p.name.toLowerCase().includes(s) || (!!digits && digits.length >= 3 && (p.phone ?? '').includes(digits.replace(/^0/, ''))) || (p.email ?? '').toLowerCase().includes(s))
      && (!q.segment || p.segment === q.segment) && (!q.tag || p.tags.includes(q.tag)) && (!q.tier || p.tier === q.tier));
    const by = q.sort ?? 'spend';
    list = list.sort((a, b) => by === 'name' ? a.name.localeCompare(b.name) : by === 'recent' ? (b.stats.lastVisit ?? '').localeCompare(a.stats.lastVisit ?? '') : by === 'visits' ? b.stats.visits - a.stats.visits : by === 'points' ? b.pointsBalance - a.pointsBalance : b.stats.spend365 - a.stats.spend365);
    return { total: list.length, tags: [...new Set(d.profiles.flatMap((p) => p.tags))].sort(), customers: list.slice(0, 500).map(summary) };
  });

  app.post('/api/crm/customers', staff, async (req) => {
    const p = userOf(req);
    const b = parse(guest.extend({ tags: z.array(z.string().max(40)).max(20).optional(), preferences: prefs.optional() }), req.body);
    const ctx = await crmContext(p.tenantId);
    const r = await db.transaction((tx) => findOrCreateGuest(p, { ...b, email: b.email || null, source: 'manual' }, ctx, req.ip, tx));
    if (!r.created) throw conflict('A guest with this mobile number already exists');
    return { id: r.customer.id };
  });

  app.get('/api/crm/customers/:id', staff, async (req) => {
    const t = userOf(req).tenantId;
    const id = (req.params as { id: string }).id;
    const d = await oneProfile(t, id);
    const res = d.rows.reservations.filter((r) => r.customerId === id).sort((a, b) => b.date.localeCompare(a.date));
    const consentEvents = await db.select().from(schema.crmConsentEvents).where(and(eq(schema.crmConsentEvents.tenantId, t), eq(schema.crmConsentEvents.customerId, id))).orderBy(desc(schema.crmConsentEvents.createdAt));
    const names = await empName(t, [d.p.referredByEmployeeId, ...res.flatMap((r) => [r.hostEmployeeId, r.promoterEmployeeId]), ...d.rows.visits.filter((v) => v.customerId === id).map((v) => v.serverEmployeeId)]);
    return {
      profile: d.p, recognition: recognition(d.p), settings: { loyalty: d.settings.loyalty, tiers: d.settings.tiers, consentText: d.settings.consentText, categories: d.settings.categories },
      referredBy: d.p.referredByEmployeeId ? { id: d.p.referredByEmployeeId, name: names.get(d.p.referredByEmployeeId) ?? '—' } : null,
      visits: d.rows.visits.filter((v) => v.customerId === id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((v) => ({ ...v, serverName: v.serverEmployeeId ? names.get(v.serverEmployeeId) ?? null : null })),
      points: d.rows.points.filter((x) => x.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reservations: res.map((r) => ({ ...r, hostName: r.hostEmployeeId ? names.get(r.hostEmployeeId) ?? null : null, promoterName: r.promoterEmployeeId ? names.get(r.promoterEmployeeId) ?? null : null })),
      messages: d.rows.messages.filter((m) => m.customerId === id),
      consentEvents: consentEvents.map((e) => ({ id: e.id, channel: e.channel, granted: e.granted, source: e.source, textVersion: e.textVersion, text: e.text, createdAt: e.createdAt.toISOString() })),
    };
  });

  app.patch('/api/crm/customers/:id', staff, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const b = parse(z.object({ phone: z.string().max(30).nullable(), firstName: z.string().trim().max(80), lastName: z.string().trim().max(80), email: z.email().max(200).nullable().or(z.literal('')), birthday: mmdd, tags: z.array(z.string().trim().min(1).max(40)).max(20), preferences: prefs, referredByEmployeeId: uuid.nullable() }).partial().strict(), req.body);
    const c = await getCustomer(p.tenantId, id);
    if (c.erasedAt) throw badRequest('This guest was erased');
    const patch: Partial<typeof schema.crmCustomers.$inferInsert> = { ...b, email: b.email === '' ? null : b.email, updatedAt: new Date() };
    if (b.phone !== undefined) {
      const phone = b.phone ? normalizePhone(b.phone) : null;
      if (b.phone && !phone) throw badRequest('That does not look like a mobile number');
      if (phone && phone !== c.phone) {
        const [other] = await db.select({ id: schema.crmCustomers.id }).from(schema.crmCustomers).where(and(eq(schema.crmCustomers.tenantId, p.tenantId), eq(schema.crmCustomers.phone, phone)));
        if (other) throw conflict('Another guest already has this number');
      }
      patch.phone = phone;
    }
    await db.update(schema.crmCustomers).set(patch).where(eq(schema.crmCustomers.id, id));
    await audit(p, { entity: 'crm_customer', entityId: id, action: 'update', before: Object.fromEntries(Object.keys(b).map((k) => [k, c[k as keyof typeof c]])), after: b }, db, req.ip);
    return { ok: true };
  });

  app.post('/api/crm/customers/:id/consent', staff, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ channel, granted: z.boolean(), source: z.enum(['counter', 'web_form', 'reservation', 'admin']).default('admin') }), req.body);
    const ctx = await crmContext(p.tenantId);
    const consent = await setConsent(p, (req.params as { id: string }).id, b.channel, b.granted, b.source, ctx, req.ip);
    await audit(p, { entity: 'crm_customer', entityId: (req.params as { id: string }).id, action: b.granted ? 'consent_grant' : 'consent_withdraw', after: { channel: b.channel } }, db, req.ip);
    return { consent };
  });

  app.post('/api/crm/customers/:id/visits', staff, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const b = parse(z.object({ amount: money, items: z.number().int().min(0).max(1000).optional(), categories: z.array(z.string().max(40)).max(10).optional(), note: z.string().max(300).optional(), serverEmployeeId: uuid.nullable().optional() }), req.body);
    const c = await getCustomer(p.tenantId, id);
    if (c.erasedAt) throw badRequest('This guest was erased');
    const ctx = await crmContext(p.tenantId);
    const r = await recordVisit(p, { customerId: id, ...b, source: 'counter' }, ctx);
    return { visitId: r.visit.id, pointsEarned: r.points, balance: await pointsBalance(id) };
  });

  app.post('/api/crm/customers/:id/redeem', staff, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ rewardKey: z.string().max(40) }), req.body);
    const ctx = await crmContext(p.tenantId);
    return redeem(p, (req.params as { id: string }).id, b.rewardKey, ctx.settings, ctx.today, req.ip);
  });

  app.post('/api/crm/customers/:id/points', admin, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const b = parse(z.object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine((x) => x !== 0, 'Non-zero'), reason }), req.body);
    await getCustomer(p.tenantId, id);
    const ctx = await crmContext(p.tenantId);
    await db.insert(schema.crmPoints).values({ tenantId: p.tenantId, customerId: id, kind: 'adjust', points: b.points, note: b.reason, date: ctx.today, createdBy: p.userId });
    await audit(p, { entity: 'crm_customer', entityId: id, action: 'points_adjust', after: { points: b.points }, reason: b.reason }, db, req.ip);
    return { balance: await pointsBalance(id) };
  });

  app.get('/api/crm/customers/:id/export', admin, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const c = await getCustomer(p.tenantId, id);
    const ctx = await crmContext(p.tenantId);
    const [visits, points, reservations, messages, consentEvents] = await Promise.all([
      db.select().from(schema.crmVisits).where(eq(schema.crmVisits.customerId, id)), db.select().from(schema.crmPoints).where(eq(schema.crmPoints.customerId, id)),
      db.select().from(schema.crmReservations).where(eq(schema.crmReservations.customerId, id)), db.select().from(schema.crmMessages).where(eq(schema.crmMessages.customerId, id)),
      db.select().from(schema.crmConsentEvents).where(eq(schema.crmConsentEvents.customerId, id)),
    ]);
    await audit(p, { entity: 'crm_customer', entityId: id, action: 'export' }, db, req.ip);
    return exportCustomer({
      customer: toCustomer(c), visits: visits.map(toVisit), points: points.map(toPoints), reservations: reservations.map(toReservation), messages: messages.map(toMessage),
      consentEvents: consentEvents.map((e) => ({ channel: e.channel, granted: e.granted, source: e.source, wording: e.text, version: e.textVersion, at: e.createdAt.toISOString() })),
      business: ctx.business, exportedAt: new Date().toISOString(),
    });
  });

  app.post('/api/crm/customers/:id/erase', admin, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const b = parse(z.object({ reason }), req.body);
    const c = await getCustomer(p.tenantId, id);
    if (c.erasedAt) return { ok: true };
    await db.transaction(async (tx) => {
      await tx.update(schema.crmCustomers).set({ ...ERASED_FIELDS, erasedAt: new Date(), updatedAt: new Date() }).where(eq(schema.crmCustomers.id, id));
      await tx.update(schema.crmMessages).set({ to: '[erased]', body: '[erased]' }).where(eq(schema.crmMessages.customerId, id));
      await tx.update(schema.crmReservations).set({ notes: null }).where(eq(schema.crmReservations.customerId, id));
      await tx.update(schema.crmConsentEvents).set({ ip: null }).where(eq(schema.crmConsentEvents.customerId, id));
      await audit(p, { entity: 'crm_customer', entityId: id, action: 'erase' }, tx, req.ip); // no personal data in the audit entry
    });
    req.log.info({ customerId: id, reason: b.reason }, 'crm guest erased');
    return { ok: true };
  });

  // ------------------------------------------------------------ counter (Square-style)
  app.get('/api/crm/lookup', staff, async (req) => {
    const q = parse(z.object({ phone: z.string().max(30) }), req.query);
    const phone = normalizePhone(q.phone);
    if (!phone) return { found: false, phone: null, valid: false };
    const d = await loadProfiles(userOf(req).tenantId);
    const prof = d.profiles.find((x) => x.phone === phone && !x.erasedAt);
    if (!prof) return { found: false, phone, valid: true, consentText: d.settings.consentText.replaceAll('{{business}}', d.business) };
    return { found: true, phone, valid: true, profile: summary(prof), recognition: recognition(prof), preferences: prof.preferences, rewards: prof.rewards, nextReward: prof.nextReward, consentText: d.settings.consentText.replaceAll('{{business}}', d.business) };
  });

  app.post('/api/crm/checkin', staff, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({
      phone: z.string().max(30), firstName: z.string().trim().max(80).optional(), consentSms: z.boolean().optional(), amount: money,
      items: z.number().int().min(0).max(1000).optional(), categories: z.array(z.string().max(40)).max(10).optional(), receiptNo: z.string().trim().max(60).optional(),
      serverEmployeeId: uuid.nullable().optional(),
    }), req.body);
    const ctx = await crmContext(p.tenantId);
    const r = await db.transaction(async (tx) => {
      const g = await findOrCreateGuest(p, { phone: b.phone, firstName: b.firstName, source: 'counter', consentSms: b.consentSms }, ctx, req.ip, tx);
      if (g.customer.erasedAt) throw badRequest('This number belongs to an erased profile');
      const v = b.amount > 0 ? await recordVisit(p, { customerId: g.customer.id, amount: b.amount, items: b.items, categories: b.categories, source: 'counter', externalRef: b.receiptNo || null, serverEmployeeId: b.serverEmployeeId }, ctx, tx) : null;
      return { g, v };
    });
    const { p: prof } = await oneProfile(p.tenantId, r.g.customer.id);
    return { customerId: prof.id, created: r.g.created, duplicate: r.v?.duplicate ?? false, pointsEarned: r.v?.points ?? 0, profile: summary(prof), recognition: recognition(prof), rewards: prof.rewards, nextReward: prof.nextReward, loyaltyName: ctx.settings.loyalty.name };
  });

  // ------------------------------------------------------------ reservations / guestlist (nightclub VIP)
  app.get('/api/crm/reservations', staff, async (req) => {
    const t = userOf(req).tenantId;
    const d = await loadProfiles(t);
    const q = parse(z.object({ date: isoDate.optional(), from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const from = q.from ?? q.date ?? d.today; const to = q.to ?? q.date ?? d.today;
    const list = d.rows.reservations.filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.arrivalTime ?? '').localeCompare(b.arrivalTime ?? ''));
    const names = await empName(t, list.flatMap((r) => [r.hostEmployeeId, r.promoterEmployeeId]));
    const byId = new Map(d.profiles.map((x) => [x.id, x]));
    return {
      date: from, today: d.today,
      reservations: list.map((r) => { const g = byId.get(r.customerId)!; return { ...r, guest: summary(g), recognition: recognition(g), preferences: g.preferences, hostName: r.hostEmployeeId ? names.get(r.hostEmployeeId) ?? null : null, promoterName: r.promoterEmployeeId ? names.get(r.promoterEmployeeId) ?? null : null }; }),
      totals: { bookings: list.filter((r) => r.status !== 'cancelled').length, guests: list.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + r.partySize, 0), minSpend: list.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + r.minSpend, 0), arrived: list.filter((r) => r.status === 'arrived' || r.status === 'completed').length, noShows: list.filter((r) => r.status === 'no_show').length },
    };
  });

  const resBody = z.object({
    date: isoDate, arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), partySize: z.number().int().min(1).max(200), tableArea: z.string().max(80).nullable().optional(),
    minSpend: money.optional(), deposit: money.optional(), hostEmployeeId: uuid.nullable().optional(), promoterEmployeeId: uuid.nullable().optional(), notes: z.string().max(1000).nullable().optional(),
    status: z.enum(['requested', 'confirmed']).optional(),
  });
  app.post('/api/crm/reservations', staff, async (req) => {
    const p = userOf(req);
    const b = parse(resBody.extend({ customerId: uuid.optional(), phone: z.string().max(30).optional(), firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(), consentSms: z.boolean().optional() }), req.body);
    const ctx = await crmContext(p.tenantId);
    const r = await db.transaction(async (tx) => {
      const customerId = b.customerId ?? (await findOrCreateGuest(p, { phone: b.phone, firstName: b.firstName, lastName: b.lastName, source: 'reservation', consentSms: b.consentSms, referredByEmployeeId: b.promoterEmployeeId ?? null }, ctx, req.ip, tx)).customer.id;
      const [row] = await tx.insert(schema.crmReservations).values({
        tenantId: p.tenantId, customerId, date: b.date, arrivalTime: b.arrivalTime ?? null, partySize: b.partySize, tableArea: b.tableArea ?? null, minSpend: b.minSpend ?? 0, deposit: b.deposit ?? 0,
        hostEmployeeId: b.hostEmployeeId ?? null, promoterEmployeeId: b.promoterEmployeeId ?? null, notes: b.notes ?? null, status: b.status ?? 'confirmed', createdBy: p.userId,
      }).returning();
      await audit(p, { entity: 'crm_reservation', entityId: row.id, action: 'create', after: { date: b.date, table: b.tableArea, partySize: b.partySize } }, tx, req.ip);
      return row;
    });
    return { id: r.id, customerId: r.customerId };
  });

  app.patch('/api/crm/reservations/:id', staff, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const b = parse(resBody.partial().extend({ status: z.enum(['requested', 'confirmed', 'arrived', 'completed', 'no_show', 'cancelled']).optional(), actualSpend: money.nullable().optional(), categories: z.array(z.string().max(40)).max(10).optional() }).strict(), req.body);
    const [r] = await db.select().from(schema.crmReservations).where(and(eq(schema.crmReservations.tenantId, p.tenantId), eq(schema.crmReservations.id, id)));
    if (!r) throw notFound('Reservation');
    const ctx = await crmContext(p.tenantId);
    const { categories, ...fields } = b;
    let pointsEarned = 0;
    await db.transaction(async (tx) => {
      await tx.update(schema.crmReservations).set({ ...fields, updatedAt: new Date() }).where(eq(schema.crmReservations.id, id));
      // Closing the table records the night's spend on the guest's profile (once — keyed by the reservation).
      if (b.status === 'completed' && (b.actualSpend ?? r.actualSpend ?? 0) > 0) {
        const v = await recordVisit(p, { customerId: r.customerId, amount: b.actualSpend ?? r.actualSpend ?? 0, categories: categories ?? ['table'], source: 'reservation', externalRef: r.id, reservationId: r.id, serverEmployeeId: r.hostEmployeeId, note: r.tableArea }, ctx, tx);
        pointsEarned = v.points;
      }
      await audit(p, { entity: 'crm_reservation', entityId: id, action: 'update', before: { status: r.status, actualSpend: r.actualSpend }, after: b }, tx, req.ip);
    });
    return { ok: true, pointsEarned };
  });

  /** Promoter / VIP host attribution — who brings the guests and the money (feeds HR commissions). */
  app.get('/api/crm/attribution', staff, async (req) => {
    const t = userOf(req).tenantId;
    const d = await loadProfiles(t);
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const to = q.to ?? d.today; const from = q.from ?? DateTime.fromISO(to).minus({ days: 29 }).toISODate()!;
    const res = d.rows.reservations.filter((r) => r.date >= from && r.date <= to);
    const people = new Map<string, { employeeId: string; role: 'promoter' | 'host'; bookings: number; guests: number; arrived: number; noShows: number; spend: number; minSpend: number; newGuests: number }>();
    const bump = (eid: string | null, role: 'promoter' | 'host', r: typeof res[number]) => {
      if (!eid) return;
      const k = `${role}:${eid}`;
      const x = people.get(k) ?? { employeeId: eid, role, bookings: 0, guests: 0, arrived: 0, noShows: 0, spend: 0, minSpend: 0, newGuests: 0 };
      if (r.status !== 'cancelled') { x.bookings++; x.guests += r.partySize; x.minSpend += r.minSpend; }
      if (r.status === 'arrived' || r.status === 'completed') x.arrived++;
      if (r.status === 'no_show') x.noShows++;
      x.spend += r.actualSpend ?? 0;
      people.set(k, x);
    };
    for (const r of res) { bump(r.promoterEmployeeId, 'promoter', r); bump(r.hostEmployeeId, 'host', r); }
    for (const prof of d.profiles) if (prof.referredByEmployeeId && prof.stats.firstVisit && prof.stats.firstVisit >= from && prof.stats.firstVisit <= to) { const x = people.get(`promoter:${prof.referredByEmployeeId}`); if (x) x.newGuests++; }
    const names = await empName(t, [...people.values()].map((x) => x.employeeId));
    return { from, to, people: [...people.values()].map((x) => ({ ...x, name: names.get(x.employeeId) ?? '—' })).sort((a, b) => b.spend - a.spend) };
  });

  // ------------------------------------------------------------ campaigns
  app.post('/api/crm/campaigns/preview', staff, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ filter, channel: channel.default('sms'), template: z.string().max(1000).default(''), holdoutPct: z.number().int().min(0).max(50).optional() }), req.body);
    const d = await loadProfiles(p.tenantId);
    const a = selectAudience(d.profiles, b.filter as AudienceFilter, b.channel, 'marketing', d.today);
    const reasons: Record<string, number> = {};
    for (const x of a.excluded) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
    const hp = b.holdoutPct ?? d.settings.holdoutPct;
    const samples = a.eligible.slice(0, 3).map((x) => planMessage(x, { template: b.template || '…', channel: b.channel, purpose: 'marketing', business: d.business, settings: d.settings })).filter((m) => !('skip' in m)) as Exclude<ReturnType<typeof planMessage>, { skip: string }>[];
    const parts = samples[0]?.parts ?? (b.template ? smsParts(b.template).parts : 1);
    const toSend = Math.round(a.eligible.length * (1 - hp / 100));
    return { matched: a.matched, eligible: a.eligible.length, excluded: reasons, holdout: a.eligible.length - toSend, toSend, parts, estCost: Math.round(toSend * parts * d.settings.costPerSms * 100) / 100, samples: samples.map((m) => ({ body: m.body, parts: m.parts })), quiet: inQuietHours(DateTime.now().setZone(d.tz).hour, d.settings.quietHours) };
  });

  app.get('/api/crm/campaigns', staff, async (req) => {
    const d = await loadProfiles(userOf(req).tenantId);
    return d.rows.campaigns.map((c) => ({ ...c, holdoutIds: undefined, holdout: c.holdoutIds.length, messages: d.rows.messages.filter((m) => m.campaignId === c.id).length, result: campaignResult(c, d.rows.messages, d.rows.visits, d.settings, d.today) }));
  });

  app.get('/api/crm/campaigns/:id', staff, async (req) => {
    const d = await loadProfiles(userOf(req).tenantId);
    const c = d.rows.campaigns.find((x) => x.id === (req.params as { id: string }).id);
    if (!c) throw notFound('Campaign');
    const msgs = d.rows.messages.filter((m) => m.campaignId === c.id);
    const statuses: Record<string, number> = {};
    for (const m of msgs) statuses[m.status] = (statuses[m.status] ?? 0) + 1;
    return { ...c, holdoutIds: undefined, holdout: c.holdoutIds.length, statuses, cost: msgs.reduce((a, m) => a + m.cost, 0), sample: msgs.slice(0, 5).map((m) => ({ to: m.to, body: m.body, status: m.status })), result: campaignResult(c, d.rows.messages, d.rows.visits, d.settings, d.today) };
  });

  app.post('/api/crm/campaigns', staff, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(120), channel: channel.default('sms'), template: z.string().trim().min(5).max(1000), filter, holdoutPct: z.number().int().min(0).max(50).optional(), attributionDays: z.number().int().min(1).max(90).optional() }), req.body);
    const ctx = await crmContext(p.tenantId);
    const [c] = await db.insert(schema.crmCampaigns).values({ tenantId: p.tenantId, name: b.name, channel: b.channel, template: b.template, filter: b.filter as AudienceFilter, holdoutPct: b.holdoutPct ?? ctx.settings.holdoutPct, attributionDays: b.attributionDays ?? ctx.settings.attributionDays, createdBy: p.userId }).returning();
    return { id: c.id };
  });

  app.delete('/api/crm/campaigns/:id', staff, async (req) => {
    const p = userOf(req);
    const [c] = await db.delete(schema.crmCampaigns).where(and(eq(schema.crmCampaigns.tenantId, p.tenantId), eq(schema.crmCampaigns.id, (req.params as { id: string }).id), eq(schema.crmCampaigns.status, 'draft'))).returning();
    if (!c) throw badRequest('Only draft campaigns can be deleted');
    return { ok: true };
  });

  app.post('/api/crm/campaigns/:id/send', admin, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ force: z.boolean().optional() }), req.body ?? {});
    const id = (req.params as { id: string }).id;
    const d = await loadProfiles(p.tenantId);
    const c = d.rows.campaigns.find((x) => x.id === id);
    if (!c) throw notFound('Campaign');
    if (c.status !== 'draft') throw conflict('This campaign was already sent');
    if (inQuietHours(DateTime.now().setZone(d.tz).hour, d.settings.quietHours) && !b.force) throw new HttpError(409, `It is quiet hours (${d.settings.quietHours.start}:00–${d.settings.quietHours.end}:00). Schedule for later or send anyway.`);
    // Claim the campaign first so a double click cannot send twice.
    const [claimed] = await db.update(schema.crmCampaigns).set({ status: 'sent', sentAt: new Date() }).where(and(eq(schema.crmCampaigns.id, id), eq(schema.crmCampaigns.status, 'draft'))).returning();
    if (!claimed) throw conflict('This campaign was already sent');
    const a = selectAudience(d.profiles, c.filter, c.channel, 'marketing', d.today);
    const holdout = a.eligible.filter((x) => inHoldout(x.id, c.id, c.holdoutPct)).map((x) => x.id);
    const held = new Set(holdout);
    const planned = a.eligible.filter((x) => !held.has(x.id)).map((x) => planMessage(x, { template: c.template, channel: c.channel, purpose: 'marketing', business: d.business, settings: d.settings }))
      .filter((m): m is Exclude<typeof m, { skip: string }> => !('skip' in m)).map((m) => ({ ...m, campaignId: c.id }));
    await db.update(schema.crmCampaigns).set({ holdoutIds: holdout }).where(eq(schema.crmCampaigns.id, id));
    const r = await sendPlanned(p.tenantId, planned, { settings: d.settings, today: d.today, createdBy: p.userId });
    await audit(p, { entity: 'crm_campaign', entityId: id, action: 'send', after: { sent: r.sent, failed: r.failed, holdout: holdout.length, provider: r.provider } }, db, req.ip);
    return { ...r, holdout: holdout.length };
  });

  // ------------------------------------------------------------ automations & outbox
  app.get('/api/crm/automations', staff, async (req) => {
    const t = userOf(req).tenantId;
    const rows = (await db.select().from(schema.crmAutomations).where(eq(schema.crmAutomations.tenantId, t))).sort((a, b) => a.sortOrder - b.sortOrder).map(toAutomation);
    const plan = await runAutomations(t, { dryRun: true });
    const msgs = await db.select({ key: schema.crmMessages.automationKey, createdAt: schema.crmMessages.createdAt }).from(schema.crmMessages).where(eq(schema.crmMessages.tenantId, t));
    return {
      quiet: plan.quiet, triggers: TRIGGERS,
      automations: rows.map((a) => ({ ...a, dueToday: plan.messages.filter((m) => m.automationKey === a.key).length, blockedToday: plan.skipped.filter((m) => m.automationKey === a.key).length, sent30: msgs.filter((m) => m.key === a.key && Date.now() - m.createdAt.getTime() < 30 * 86_400_000).length })),
      preview: plan.messages.slice(0, 20).map((m) => ({ automationName: m.automationName, to: m.to, body: m.body })),
    };
  });

  app.patch('/api/crm/automations/:id', admin, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ enabled: z.boolean(), name: z.string().trim().min(2).max(80), template: z.string().trim().min(5).max(1000), days: z.number().int().min(0).max(365), bonusPoints: z.number().int().min(0).max(100_000).nullable(), filter }).partial().strict(), req.body);
    const [a] = await db.update(schema.crmAutomations).set(b).where(and(eq(schema.crmAutomations.tenantId, p.tenantId), eq(schema.crmAutomations.id, (req.params as { id: string }).id))).returning();
    if (!a) throw notFound('Automation');
    await audit(p, { entity: 'crm_automation', entityId: a.id, action: 'update', after: b }, db, req.ip);
    return toAutomation(a);
  });

  app.post('/api/crm/automations/run', admin, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ dryRun: z.boolean().default(true), force: z.boolean().optional() }), req.body ?? {});
    const r = await runAutomations(p.tenantId, { dryRun: b.dryRun, force: b.force, createdBy: p.userId });
    return { quiet: r.quiet, sent: r.sentCount, planned: r.messages.length, skipped: r.skipped.length, provider: r.provider, messages: r.messages.slice(0, 50).map((m) => ({ automationName: m.automationName, to: m.to, body: m.body })) };
  });

  app.get('/api/crm/messages', staff, async (req) => {
    const t = userOf(req).tenantId;
    const rows = await db.select({ m: schema.crmMessages, f: schema.crmCustomers.firstName, l: schema.crmCustomers.lastName }).from(schema.crmMessages)
      .leftJoin(schema.crmCustomers, eq(schema.crmCustomers.id, schema.crmMessages.customerId)).where(eq(schema.crmMessages.tenantId, t)).orderBy(desc(schema.crmMessages.createdAt)).limit(300);
    const camps = await db.select({ id: schema.crmCampaigns.id, name: schema.crmCampaigns.name }).from(schema.crmCampaigns).where(eq(schema.crmCampaigns.tenantId, t));
    return rows.map(({ m, f, l }) => ({ ...toMessage(m), guestName: `${f ?? ''} ${l ?? ''}`.trim() || 'Guest', campaignName: camps.find((c) => c.id === m.campaignId)?.name ?? null }));
  });

  // ------------------------------------------------------------ integrations
  /** POS push: any POS (or the AI Manager POS) posts closed bills with the guest's mobile. Idempotent on receiptNo. */
  app.post('/api/crm/pos/transactions', { preHandler: requireDevice, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req) => {
    const dev = req.principal as Extract<Principal, { kind: 'device' }>;
    const b = parse(z.object({
      receiptNo: z.string().trim().min(1).max(60), amount: money, phone: z.string().max(30).optional(), firstName: z.string().trim().max(80).optional(),
      items: z.number().int().min(0).max(10_000).optional(), categories: z.array(z.string().max(40)).max(20).optional(), occurredAt: z.iso.datetime({ offset: true }).optional(), consentSms: z.boolean().optional(),
    }), req.body);
    if (!b.phone) return { identified: false };
    const ctx: Ctx = await crmContext(dev.tenantId);
    return db.transaction(async (tx) => {
      const g = await findOrCreateGuest(dev, { phone: b.phone, firstName: b.firstName, source: 'pos', consentSms: b.consentSms }, ctx, req.ip, tx);
      if (g.customer.erasedAt) return { identified: false };
      const v = await recordVisit(dev, { customerId: g.customer.id, amount: b.amount, items: b.items, categories: b.categories, occurredAt: b.occurredAt ? new Date(b.occurredAt) : undefined, source: 'pos', externalRef: b.receiptNo, branchId: dev.branchId }, ctx, tx);
      return { identified: true, customerId: g.customer.id, created: g.created, duplicate: v.duplicate, pointsEarned: v.points, balance: await pointsBalance(g.customer.id, tx) };
    });
  });

  /** CSV/spreadsheet import. Consent is only imported with evidence of how it was collected. */
  app.post('/api/crm/import', admin, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({
      rows: z.array(z.object({ firstName: z.string().max(80).optional(), lastName: z.string().max(80).optional(), phone: z.string().max(30).optional(), email: z.string().max(200).optional(), birthday: z.string().max(10).optional(), consentSms: z.boolean().optional(), tags: z.array(z.string().max(40)).max(10).optional() })).min(1).max(5000),
      consentEvidence: z.string().trim().max(300).optional(),
    }), req.body);
    if (b.rows.some((r) => r.consentSms) && (!b.consentEvidence || b.consentEvidence.length < 10)) throw badRequest('Describe how SMS consent was collected (e.g. "Signed guestlist forms, Oct 2026") before importing consent');
    const ctx = await crmContext(p.tenantId);
    let created = 0, existing = 0; const errors: { row: number; error: string }[] = [];
    for (const [i, r] of b.rows.entries()) {
      try {
        const birthday = r.birthday && /^\d{2}-\d{2}$/.test(r.birthday) ? r.birthday : r.birthday && /^\d{4}-\d{2}-\d{2}$/.test(r.birthday) ? r.birthday.slice(5) : null;
        const g = await db.transaction((tx) => findOrCreateGuest(p, { phone: r.phone || null, firstName: r.firstName, lastName: r.lastName, email: r.email || null, birthday, source: 'import', consentSms: r.consentSms, tags: r.tags }, ctx, req.ip, tx));
        if (g.created) created++; else existing++;
      } catch (e) { errors.push({ row: i + 1, error: (e as Error).message }); }
    }
    await audit(p, { entity: 'crm_customer', action: 'import', after: { created, existing, errors: errors.length, consentEvidence: b.consentEvidence ?? null } }, db, req.ip);
    return { created, existing, errors: errors.slice(0, 50) };
  });

  /** Inbound SMS (STOP replies) from the SMS gateway. Records the withdrawal of marketing consent. */
  app.post('/api/crm/inbound/sms', async (req) => {
    const q = req.query as { key?: string };
    if (!config.crmInboundSecret || q.key !== config.crmInboundSecret) throw forbidden('Bad key');
    const b = req.body as Record<string, string>;
    const from = normalizePhone(b.from ?? b.number ?? b.sender ?? '');
    const text = String(b.message ?? b.text ?? b.body ?? '');
    if (!from || !isOptOutReply(text)) return { ok: true, optOut: false };
    const guests = await db.select().from(schema.crmCustomers).where(eq(schema.crmCustomers.phone, from));
    for (const g of guests) {
      const ctx = await crmContext(g.tenantId);
      await setConsent({ kind: 'device', deviceId: 'sms-gateway', tenantId: g.tenantId, branchId: null }, g.id, 'sms', false, 'sms_stop', ctx, req.ip);
    }
    return { ok: true, optOut: true, profiles: guests.length };
  });

  app.get('/api/crm/meta', staff, async () => ({ channels: CHANNELS, segments: SEGMENTS, triggers: TRIGGERS }));
}
