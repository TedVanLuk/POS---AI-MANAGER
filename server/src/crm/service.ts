/**
 * CRM service: loads a tenant's CRM rows, records visits and points, sends messages.
 * Pilot-scale design: a venue has thousands of guests, so profiles are computed in memory per request
 * from the rows (identical code path to the browser demo). Move aggregation to SQL views past ~50k visits.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { Principal } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { buildProfiles, businessDate, planAutomations, todayFor, type CampaignRow, type CustomerRow, type MessageRow, type PlannedMessage, type PointsRow, type ReservationRow, type VisitRow } from './core.js';
import { expiringPoints, inQuietHours, pointsForVisit, renderTemplate, tierFor, type Channel, type ConsentState, type CrmSettings } from './engine.js';
import { provider } from './messaging.js';
import { normalizePhone } from './phone.js';
import { crmWithDefaults } from './playbooks.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function crmContext(tenantId: string) {
  const t = await getTenant(tenantId);
  const settings = crmWithDefaults(t.settings.crm);
  return { tenant: t, settings, tz: t.timezone, today: todayFor(t.timezone, settings.dayStartHour), business: t.name };
}

export const toCustomer = (c: typeof schema.crmCustomers.$inferSelect): CustomerRow => ({
  id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email, birthday: c.birthday, source: c.source,
  referredByEmployeeId: c.referredByEmployeeId, tags: c.tags, preferences: c.preferences, consent: c.consent, erasedAt: iso(c.erasedAt), createdAt: c.createdAt.toISOString(),
});
export const toVisit = (v: typeof schema.crmVisits.$inferSelect): VisitRow => ({
  id: v.id, customerId: v.customerId, occurredAt: v.occurredAt.toISOString(), date: v.date, amount: v.amount, items: v.items, categories: v.categories,
  source: v.source, externalRef: v.externalRef, reservationId: v.reservationId, serverEmployeeId: v.serverEmployeeId, pointsEarned: v.pointsEarned, note: v.note,
});
export const toPoints = (p: typeof schema.crmPoints.$inferSelect): PointsRow => ({ id: p.id, customerId: p.customerId, visitId: p.visitId, kind: p.kind, points: p.points, rewardKey: p.rewardKey, note: p.note, createdAt: p.createdAt.toISOString(), date: p.date });
export const toReservation = (r: typeof schema.crmReservations.$inferSelect): ReservationRow => ({
  id: r.id, customerId: r.customerId, date: r.date, arrivalTime: r.arrivalTime, partySize: r.partySize, tableArea: r.tableArea, minSpend: r.minSpend, deposit: r.deposit,
  status: r.status, hostEmployeeId: r.hostEmployeeId, promoterEmployeeId: r.promoterEmployeeId, notes: r.notes, actualSpend: r.actualSpend, createdAt: r.createdAt.toISOString(),
});
export const toMessage = (m: typeof schema.crmMessages.$inferSelect): MessageRow => ({
  id: m.id, customerId: m.customerId, campaignId: m.campaignId, automationKey: m.automationKey, channel: m.channel, purpose: m.purpose, to: m.to, body: m.body,
  status: m.status, provider: m.provider, providerRef: m.providerRef, error: m.error, parts: m.parts, cost: m.cost, createdAt: m.createdAt.toISOString(),
});
export const toCampaign = (c: typeof schema.crmCampaigns.$inferSelect): CampaignRow => ({
  id: c.id, name: c.name, channel: c.channel, template: c.template, filter: c.filter, holdoutPct: c.holdoutPct, status: c.status, sentAt: iso(c.sentAt),
  holdoutIds: c.holdoutIds, attributionDays: c.attributionDays, createdAt: c.createdAt.toISOString(),
});

export async function loadRows(tenantId: string) {
  const s = schema;
  const [customers, visits, points, reservations, messages, campaigns] = await Promise.all([
    db.select().from(s.crmCustomers).where(eq(s.crmCustomers.tenantId, tenantId)),
    db.select().from(s.crmVisits).where(eq(s.crmVisits.tenantId, tenantId)),
    db.select().from(s.crmPoints).where(eq(s.crmPoints.tenantId, tenantId)),
    db.select().from(s.crmReservations).where(eq(s.crmReservations.tenantId, tenantId)),
    db.select().from(s.crmMessages).where(eq(s.crmMessages.tenantId, tenantId)),
    db.select().from(s.crmCampaigns).where(eq(s.crmCampaigns.tenantId, tenantId)),
  ]);
  return {
    customers: customers.map(toCustomer), visits: visits.map(toVisit), points: points.map(toPoints), reservations: reservations.map(toReservation),
    messages: messages.map(toMessage).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), campaigns: campaigns.map(toCampaign).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function loadProfiles(tenantId: string) {
  const ctx = await crmContext(tenantId);
  const rows = await loadRows(tenantId);
  return { ...ctx, rows, profiles: buildProfiles({ ...rows, settings: ctx.settings, today: ctx.today }) };
}

/** Venue revenue from order slips (all bills, identified or not) — the denominator for "identified revenue share". */
export async function venueRevenue(tenantId: string, tz: string, from: string, to: string) {
  const [r] = await db.select({ amount: sql<number>`coalesce(sum(${schema.orderSlips.amount}), 0)::float` }).from(schema.orderSlips).where(and(
    eq(schema.orderSlips.tenantId, tenantId), eq(schema.orderSlips.status, 'closed'),
    gte(schema.orderSlips.openedAt, DateTime.fromISO(from, { zone: tz }).toJSDate()), lte(schema.orderSlips.openedAt, DateTime.fromISO(to, { zone: tz }).endOf('day').toJSDate()),
  ));
  return r?.amount ? { from, to, amount: r.amount } : null;
}

// ---------------------------------------------------------------- customers & consent
export interface Ctx { settings: CrmSettings; business: string; tz: string; today: string }

export async function setConsent(p: Principal, customerId: string, channel: Channel, granted: boolean, source: string, ctx: Ctx, ip?: string, tx: Tx | typeof db = db) {
  const { settings, business } = ctx;
  const [c] = await tx.select().from(schema.crmCustomers).where(and(eq(schema.crmCustomers.tenantId, p.tenantId), eq(schema.crmCustomers.id, customerId)));
  if (!c) throw notFound('Guest');
  const at = new Date().toISOString();
  const consent: ConsentState = { ...c.consent, [channel]: { granted, at, source, version: granted ? settings.consentVersion : null } };
  await tx.update(schema.crmCustomers).set({ consent, updatedAt: new Date() }).where(eq(schema.crmCustomers.id, customerId));
  await tx.insert(schema.crmConsentEvents).values({
    tenantId: p.tenantId, customerId, channel, granted, source, textVersion: settings.consentVersion,
    text: granted ? renderTemplate(settings.consentText, { firstName: c.firstName, business }) : null, actorUserId: p.kind === 'user' ? p.userId : null, ip,
  });
  return consent;
}

export interface GuestInput { phone?: string | null; firstName?: string; lastName?: string; email?: string | null; birthday?: string | null; source: string; referredByEmployeeId?: string | null; consentSms?: boolean; tags?: string[]; preferences?: CustomerRow['preferences'] }

/** Find a guest by phone, or create one. Consent is only ever recorded when explicitly given. */
export async function findOrCreateGuest(p: Principal, g: GuestInput, ctx: Ctx, ip?: string, tx: Tx | typeof db = db) {
  const { settings } = ctx;
  const phone = g.phone ? normalizePhone(g.phone) : null;
  if (g.phone && !phone) throw badRequest('That does not look like a mobile number (e.g. 0917 123 4567)');
  if (!phone && !g.firstName?.trim()) throw badRequest('Give at least a mobile number or a name');
  let [c] = phone ? await tx.select().from(schema.crmCustomers).where(and(eq(schema.crmCustomers.tenantId, p.tenantId), eq(schema.crmCustomers.phone, phone))) : [];
  let created = false;
  if (!c) {
    [c] = await tx.insert(schema.crmCustomers).values({
      tenantId: p.tenantId, phone, firstName: g.firstName?.trim() ?? '', lastName: g.lastName?.trim() ?? '', email: g.email?.trim() || null,
      birthday: g.birthday || null, source: g.source, referredByEmployeeId: g.referredByEmployeeId ?? null, tags: g.tags ?? [], preferences: g.preferences ?? {},
      createdBy: p.kind === 'user' ? p.userId : null,
    }).returning();
    created = true;
    await audit(p, { entity: 'crm_customer', entityId: c.id, action: 'create', after: { source: g.source } }, tx, ip);
  } else if (!c.firstName && g.firstName) {
    [c] = await tx.update(schema.crmCustomers).set({ firstName: g.firstName.trim(), lastName: g.lastName?.trim() ?? c.lastName, updatedAt: new Date() }).where(eq(schema.crmCustomers.id, c.id)).returning();
  }
  if (g.consentSms && !c.consent.sms?.granted) c = { ...c, consent: await setConsent(p, c.id, 'sms', true, g.source, ctx, ip, tx) };
  if (created && settings.loyalty.enabled && settings.loyalty.welcomePoints > 0) {
    await tx.insert(schema.crmPoints).values({ tenantId: p.tenantId, customerId: c.id, kind: 'bonus', points: settings.loyalty.welcomePoints, note: 'Welcome points', date: ctx.today });
  }
  return { customer: c, created };
}

// ---------------------------------------------------------------- visits & points
export interface VisitInput { customerId: string; amount: number; items?: number; categories?: string[]; occurredAt?: Date; source: string; externalRef?: string | null; reservationId?: string | null; orderSlipId?: string | null; serverEmployeeId?: string | null; branchId?: string | null; note?: string | null }

/** Record a purchase and earn points (tier multiplier applied). Idempotent on (source, externalRef). */
export async function recordVisit(p: Principal, v: VisitInput, ctx: Ctx, tx: Tx | typeof db = db) {
  if (v.externalRef) {
    const [dup] = await tx.select().from(schema.crmVisits).where(and(eq(schema.crmVisits.tenantId, p.tenantId), eq(schema.crmVisits.source, v.source), eq(schema.crmVisits.externalRef, v.externalRef)));
    if (dup) return { visit: dup, points: 0, duplicate: true };
  }
  const at = v.occurredAt ?? new Date();
  const date = businessDate(at, ctx.tz, ctx.settings.dayStartHour);
  // Tier is decided by spend in the 12 months before this visit.
  const [prior] = await tx.select({ s: sql<number>`coalesce(sum(${schema.crmVisits.amount}), 0)::float` }).from(schema.crmVisits)
    .where(and(eq(schema.crmVisits.customerId, v.customerId), gte(schema.crmVisits.date, DateTime.fromISO(date).minus({ days: 364 }).toISODate()!)));
  const tier = tierFor(ctx.settings.tiers, prior?.s ?? 0);
  const points = pointsForVisit(ctx.settings.loyalty, v.amount, tier?.multiplier ?? 1);
  const [visit] = await tx.insert(schema.crmVisits).values({
    tenantId: p.tenantId, customerId: v.customerId, branchId: v.branchId ?? null, occurredAt: at, date, amount: v.amount, items: v.items ?? 0, categories: v.categories ?? [],
    source: v.source, externalRef: v.externalRef ?? null, reservationId: v.reservationId ?? null, orderSlipId: v.orderSlipId ?? null, serverEmployeeId: v.serverEmployeeId ?? null,
    pointsEarned: points, note: v.note ?? null, createdBy: p.kind === 'user' ? p.userId : null,
  }).returning();
  if (points > 0) await tx.insert(schema.crmPoints).values({ tenantId: p.tenantId, customerId: v.customerId, visitId: visit.id, kind: 'earn', points, note: tier && tier.multiplier > 1 ? `${tier.name} ×${tier.multiplier}` : null, date, createdBy: p.kind === 'user' ? p.userId : null });
  return { visit, points, duplicate: false };
}

export async function pointsBalance(customerId: string, tx: Tx | typeof db = db) {
  const [r] = await tx.select({ b: sql<number>`coalesce(sum(${schema.crmPoints.points}), 0)::int` }).from(schema.crmPoints).where(eq(schema.crmPoints.customerId, customerId));
  return r?.b ?? 0;
}

export async function redeem(p: Principal, customerId: string, rewardKey: string, settings: CrmSettings, today: string, ip?: string) {
  const reward = settings.loyalty.rewards.find((r) => r.key === rewardKey);
  if (!reward) throw notFound('Reward');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${customerId}))`);
    const bal = await pointsBalance(customerId, tx);
    if (bal < reward.points) throw conflict(`Not enough points: ${bal} of ${reward.points}`);
    await tx.insert(schema.crmPoints).values({ tenantId: p.tenantId, customerId, kind: 'redeem', points: -reward.points, rewardKey, note: reward.name, date: today, createdBy: p.kind === 'user' ? p.userId : null });
    await audit(p, { entity: 'crm_customer', entityId: customerId, action: 'redeem', after: { reward: reward.name, points: reward.points } }, tx, ip);
    return { reward, balance: bal - reward.points };
  });
}

/** Write 'expire' entries for points past the program's expiry (FIFO). */
export async function expirePoints(tenantId: string, settings: CrmSettings, today: string) {
  if (!settings.loyalty.expiryDays) return 0;
  const rows = await db.select().from(schema.crmPoints).where(eq(schema.crmPoints.tenantId, tenantId));
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.customerId, [...(by.get(r.customerId) ?? []), r]);
  let total = 0;
  for (const [customerId, ledger] of by) {
    const n = expiringPoints(ledger, today, settings.loyalty.expiryDays);
    if (n > 0) { total += n; await db.insert(schema.crmPoints).values({ tenantId, customerId, kind: 'expire', points: -n, note: `Expired after ${settings.loyalty.expiryDays} days`, date: today }); }
  }
  return total;
}

// ---------------------------------------------------------------- messages
export async function sendPlanned(tenantId: string, msgs: PlannedMessage[], o: { settings: CrmSettings; today: string; createdBy?: string | null }) {
  const prov = provider();
  const results: { customerId: string; status: string }[] = [];
  for (const m of msgs) {
    if (m.bonusPoints) await db.insert(schema.crmPoints).values({ tenantId, customerId: m.customerId, kind: 'bonus', points: m.bonusPoints, note: m.automationKey ? `Automation: ${m.automationKey}` : 'Campaign bonus', date: o.today });
    const r = await prov.send({ channel: m.channel, to: m.to, body: m.body, sender: o.settings.senderName });
    await db.insert(schema.crmMessages).values({
      tenantId, customerId: m.customerId, campaignId: m.campaignId ?? null, automationKey: m.automationKey ?? null, channel: m.channel, purpose: m.purpose, to: m.to, body: m.body,
      status: r.status, provider: r.provider, providerRef: r.ref, error: r.error, parts: m.parts, cost: r.status === 'failed' ? 0 : m.cost, createdBy: o.createdBy ?? null,
    });
    results.push({ customerId: m.customerId, status: r.status });
  }
  return { provider: prov.name, sent: results.filter((r) => r.status !== 'failed').length, failed: results.filter((r) => r.status === 'failed').length };
}

// ---------------------------------------------------------------- automations
export const toAutomation = (a: typeof schema.crmAutomations.$inferSelect) => ({
  id: a.id, key: a.key, name: a.name, trigger: a.trigger, enabled: a.enabled, channel: a.channel, days: a.days, filter: a.filter, template: a.template,
  bonusPoints: a.bonusPoints ?? undefined, sortOrder: a.sortOrder, lastRunAt: iso(a.lastRunAt),
});

/** Plan (dryRun) or send today's automation messages for one tenant. Quiet hours block real sends. */
export async function runAutomations(tenantId: string, o: { dryRun: boolean; force?: boolean; createdBy?: string | null }) {
  const data = await loadProfiles(tenantId);
  const autos = (await db.select().from(schema.crmAutomations).where(eq(schema.crmAutomations.tenantId, tenantId))).sort((a, b) => a.sortOrder - b.sortOrder).map(toAutomation);
  const sent = data.rows.messages.filter((m) => m.automationKey && m.customerId && m.status !== 'failed')
    .map((m) => ({ automationKey: m.automationKey!, customerId: m.customerId!, date: businessDate(m.createdAt, data.tz, data.settings.dayStartHour) }));
  const plan = planAutomations({ automations: autos, profiles: data.profiles, sent, settings: data.settings, business: data.business, today: data.today });
  const hour = DateTime.now().setZone(data.tz).hour;
  const quiet = inQuietHours(hour, data.settings.quietHours);
  if (o.dryRun || (quiet && !o.force)) return { ...plan, quiet, sentCount: 0, provider: null as string | null };
  const r = await sendPlanned(tenantId, plan.messages, { settings: data.settings, today: data.today, createdBy: o.createdBy });
  await db.update(schema.crmAutomations).set({ lastRunAt: new Date() }).where(eq(schema.crmAutomations.tenantId, tenantId));
  return { ...plan, quiet, sentCount: r.sent, provider: r.provider };
}

/** Hourly loop inside the API process: expire points and send due automations for every tenant using the CRM. */
export function startAutomationLoop(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const tick = async () => {
    const tenants = await db.selectDistinct({ tenantId: schema.crmAutomations.tenantId }).from(schema.crmAutomations).where(eq(schema.crmAutomations.enabled, true));
    for (const { tenantId } of tenants) {
      try {
        const ctx = await crmContext(tenantId);
        const expired = await expirePoints(tenantId, ctx.settings, ctx.today);
        const r = await runAutomations(tenantId, { dryRun: false });
        if (r.sentCount || expired) log.info({ tenantId, sent: r.sentCount, expired }, 'crm automations');
      } catch (e) { log.error({ tenantId, err: (e as Error).message }, 'crm automations failed'); }
    }
  };
  const timer = setInterval(() => { void tick(); }, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
