/**
 * In-browser demo of the AI Marketing / CRM API. Same routes and the same core functions as
 * server/src/modules/crm.routes.ts, over an in-memory store. Messages are always simulated.
 */
import { DateTime } from 'luxon';
import {
  buildProfiles, businessDate, campaignResult, ERASED_FIELDS, exportCustomer, overview, planAutomations, planMessage, recognition, todayFor,
  type CampaignRow, type CustomerRow, type MessageRow, type PlannedMessage, type PointsRow, type Profile, type ReservationRow, type ReservationStatus, type VisitRow,
} from '../../../server/src/crm/core';
import {
  CHANNELS, expiringPoints, inHoldout, inQuietHours, pointsForVisit, renderTemplate, SEGMENTS, selectAudience, smsParts, tierFor, TRIGGERS,
  type AudienceFilter, type AutomationDef, type Channel, type CrmSettings,
} from '../../../server/src/crm/engine';
import { normalizePhone } from '../../../server/src/crm/phone';
import { applyPlaybook, crmWithDefaults, DEFAULT_CRM, PLAYBOOKS } from '../../../server/src/crm/playbooks';
import { sampleCrm } from '../../../server/src/crm/sample';
import { TABLES } from '../../../server/src/policy/handbook';

type Auto = AutomationDef & { id: string; sortOrder: number; lastRunAt: string | null };
interface ConsentEvent { id: string; customerId: string; channel: string; granted: boolean; source: string; textVersion: string | null; text: string | null; createdAt: string }
export interface CrmStore {
  settings: CrmSettings; customers: CustomerRow[]; visits: VisitRow[]; points: PointsRow[]; reservations: ReservationRow[];
  campaigns: CampaignRow[]; messages: MessageRow[]; automations: Auto[]; consentEvents: ConsentEvent[];
}
type Role = 'owner' | 'admin' | 'manager' | 'employee';
interface User { id: string; role: Role }
type Handler = (ctx: { user: User | null; device: { id: string; active: boolean } | null }, p: Record<string, string>, q: URLSearchParams, b: Record<string, unknown>) => unknown;
interface Deps {
  on: (method: string, pattern: string, h: Handler) => void;
  crm: () => CrmStore;
  business: () => string;
  employees: () => { id: string; firstName: string; lastName: string; department: string | null }[];
  requireUser: (ctx: Parameters<Handler>[0], roles: Role[]) => User;
  requireDevice: (ctx: Parameters<Handler>[0]) => unknown;
  fail: (status: number, msg: string) => never;
  audit: (ctx: Parameters<Handler>[0], e: { entity: string; entityId?: string | null; action: string; before?: unknown; after?: unknown; reason?: string | null }) => void;
  uid: () => string;
  tz: string;
}
const STAFF: Role[] = ['owner', 'admin', 'manager'];
const ADMIN: Role[] = ['owner', 'admin'];
const nowIso = () => new Date().toISOString();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function seedCrm(o: { tz: string; uid: () => string; emp: { id: string; department: string | null }[] }): CrmStore {
  const pb = applyPlaybook({ ...DEFAULT_CRM, senderName: 'MDC' }, 'nightclub_vip');
  const ids = (dep: string) => o.emp.filter((e) => e.department === dep).map((e) => e.id);
  const s = sampleCrm({ today: todayFor(o.tz, pb.settings.dayStartHour), tz: o.tz, settings: pb.settings, business: 'MDC', uid: o.uid, emp: { promoters: ids('Promoters'), hosts: ids('VIP Host'), servers: ids('Servers'), shisha: ids('Shisha') } });
  return {
    settings: pb.settings, ...s,
    automations: pb.automations.map((a, i) => ({ ...a, id: o.uid(), sortOrder: i, lastRunAt: null })),
    consentEvents: s.customers.filter((c) => c.consent.sms).map((c) => ({ id: o.uid(), customerId: c.id, channel: 'sms', granted: true, source: c.consent.sms!.source, textVersion: c.consent.sms!.version ?? 'v1', text: pb.settings.consentText.replaceAll('{{business}}', 'MDC'), createdAt: c.consent.sms!.at })),
  };
}

export function registerCrm(d: Deps) {
  const { on, fail } = d;
  const S = () => d.crm();
  const settings = () => crmWithDefaults(S().settings);
  const today = () => todayFor(d.tz, settings().dayStartHour);
  const profiles = () => buildProfiles({ ...S(), settings: settings(), today: today() });
  const prof = (id: string) => profiles().find((p) => p.id === id) ?? fail(404, 'Guest not found');
  const cust = (id: string) => S().customers.find((c) => c.id === id) ?? fail(404, 'Guest not found');
  const empName = (id: string | null) => { if (!id) return null; const e = d.employees().find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}`.trim() : null; };
  const balance = (id: string) => S().points.filter((p) => p.customerId === id).reduce((a, p) => a + p.points, 0);
  const consentText = () => settings().consentText.replaceAll('{{business}}', d.business());
  const summary = (p: Profile) => ({
    id: p.id, name: p.name, phoneDisplay: p.phoneDisplay, email: p.email, tier: p.tier, segment: p.segment, tags: p.tags, pointsBalance: p.pointsBalance,
    visits: p.stats.visits, spend: p.stats.spend, spend365: p.stats.spend365, avgSpend: p.stats.avgSpend, lastVisit: p.stats.lastVisit, daysSinceLastVisit: p.stats.daysSinceLastVisit,
    overdue: p.stats.overdue, marketable: p.marketable, birthday: p.birthday, daysToBirthday: p.daysToBirthday, erasedAt: p.erasedAt, source: p.source, createdAt: p.createdAt,
  });

  const setConsent = (customerId: string, channel: Channel, granted: boolean, source: string) => {
    const c = cust(customerId);
    c.consent = { ...c.consent, [channel]: { granted, at: nowIso(), source, version: granted ? settings().consentVersion : null } };
    S().consentEvents.unshift({ id: d.uid(), customerId, channel, granted, source, textVersion: settings().consentVersion, text: granted ? renderTemplate(settings().consentText, { firstName: c.firstName, business: d.business() }) : null, createdAt: nowIso() });
  };
  const findOrCreate = (g: { phone?: string | null; firstName?: string; lastName?: string; email?: string | null; birthday?: string | null; source: string; consentSms?: boolean; referredByEmployeeId?: string | null; tags?: string[] }) => {
    const phone = g.phone ? normalizePhone(g.phone) : null;
    if (g.phone && !phone) fail(400, 'That does not look like a mobile number (e.g. 0917 123 4567)');
    if (!phone && !g.firstName?.trim()) fail(400, 'Give at least a mobile number or a name');
    let c = phone ? S().customers.find((x) => x.phone === phone) : undefined;
    let created = false;
    if (!c) {
      c = { id: d.uid(), firstName: g.firstName?.trim() ?? '', lastName: g.lastName?.trim() ?? '', phone, email: g.email || null, birthday: g.birthday || null, source: g.source, referredByEmployeeId: g.referredByEmployeeId ?? null, tags: g.tags ?? [], preferences: {}, consent: {}, erasedAt: null, createdAt: nowIso() };
      S().customers.push(c); created = true;
      if (settings().loyalty.enabled && settings().loyalty.welcomePoints) S().points.push({ id: d.uid(), customerId: c.id, visitId: null, kind: 'bonus', points: settings().loyalty.welcomePoints, rewardKey: null, note: 'Welcome points', createdAt: nowIso(), date: today() });
    } else if (!c.firstName && g.firstName) { c.firstName = g.firstName.trim(); c.lastName = g.lastName?.trim() ?? c.lastName; }
    if (g.consentSms && !c.consent.sms?.granted) setConsent(c.id, 'sms', true, g.source);
    return { c, created };
  };
  const recordVisit = (v: { customerId: string; amount: number; items?: number; categories?: string[]; source: string; externalRef?: string | null; reservationId?: string | null; serverEmployeeId?: string | null; note?: string | null; at?: string }) => {
    if (v.externalRef) { const dup = S().visits.find((x) => x.source === v.source && x.externalRef === v.externalRef); if (dup) return { visit: dup, points: 0, duplicate: true }; }
    const at = v.at ?? nowIso();
    const date = businessDate(at, d.tz, settings().dayStartHour);
    const from = DateTime.fromISO(date).minus({ days: 364 }).toISODate()!;
    const prior = S().visits.filter((x) => x.customerId === v.customerId && x.date >= from).reduce((a, x) => a + x.amount, 0);
    const tier = tierFor(settings().tiers, prior);
    const points = pointsForVisit(settings().loyalty, v.amount, tier?.multiplier ?? 1);
    const visit: VisitRow = { id: d.uid(), customerId: v.customerId, occurredAt: at, date, amount: v.amount, items: v.items ?? 0, categories: v.categories ?? [], source: v.source, externalRef: v.externalRef ?? null, reservationId: v.reservationId ?? null, serverEmployeeId: v.serverEmployeeId ?? null, pointsEarned: points, note: v.note ?? null };
    S().visits.push(visit);
    if (points) S().points.push({ id: d.uid(), customerId: v.customerId, visitId: visit.id, kind: 'earn', points, rewardKey: null, note: tier && tier.multiplier > 1 ? `${tier.name} ×${tier.multiplier}` : null, createdAt: at, date });
    return { visit, points, duplicate: false };
  };
  const send = (msgs: PlannedMessage[]) => {
    for (const m of msgs) {
      if (m.bonusPoints) S().points.push({ id: d.uid(), customerId: m.customerId, visitId: null, kind: 'bonus', points: m.bonusPoints, rewardKey: null, note: m.automationKey ? `Automation: ${m.automationKey}` : 'Campaign bonus', createdAt: nowIso(), date: today() });
      S().messages.unshift({ id: d.uid(), customerId: m.customerId, campaignId: m.campaignId ?? null, automationKey: m.automationKey ?? null, channel: m.channel, purpose: m.purpose, to: m.to, body: m.body, status: 'simulated', provider: 'demo', providerRef: null, error: null, parts: m.parts, cost: m.cost, createdAt: nowIso() });
    }
    return { provider: 'demo (simulated)', sent: msgs.length, failed: 0 };
  };
  const planAuto = () => {
    const sent = S().messages.filter((m) => m.automationKey && m.customerId).map((m) => ({ automationKey: m.automationKey!, customerId: m.customerId!, date: businessDate(m.createdAt, d.tz, settings().dayStartHour) }));
    return planAutomations({ automations: [...S().automations].sort((a, b) => a.sortOrder - b.sortOrder), profiles: profiles(), sent, settings: settings(), business: d.business(), today: today() });
  };
  const quiet = () => inQuietHours(DateTime.now().setZone(d.tz).hour, settings().quietHours);

  // settings & playbooks
  on('GET', '/api/crm/settings', (c) => { d.requireUser(c, STAFF); return { settings: settings(), today: today(), business: d.business(), provider: 'log', playbooks: PLAYBOOKS.map((p) => ({ key: p.key, name: p.name, summary: p.summary, businessTypes: p.businessTypes, automations: p.automations.length })), tables: TABLES, segments: SEGMENTS, triggers: TRIGGERS }; });
  on('PUT', '/api/crm/settings', (c, _p, _q, b) => {
    d.requireUser(c, ADMIN);
    const cur = settings();
    const next = { ...cur, ...(b as Partial<CrmSettings>) };
    if (typeof b.senderName === 'string' && (b.senderName.length < 3 || b.senderName.length > 11)) fail(400, 'Validation failed — senderName: 3–11 characters');
    if (typeof b.consentText === 'string' && b.consentText !== cur.consentText) next.consentVersion = `v${(parseInt(cur.consentVersion.slice(1), 10) || 1) + 1}`;
    S().settings = next;
    d.audit(c, { entity: 'crm_settings', action: 'update', after: b });
    return { settings: next };
  });
  on('POST', '/api/crm/playbooks/:key/apply', (c, p) => {
    d.requireUser(c, ADMIN);
    if (!PLAYBOOKS.some((x) => x.key === p.key)) fail(404, 'Playbook not found');
    const a = applyPlaybook(settings(), p.key);
    S().settings = a.settings;
    S().automations = a.automations.map((x, i) => ({ ...x, id: d.uid(), sortOrder: i, lastRunAt: null }));
    d.audit(c, { entity: 'crm_settings', action: 'apply_playbook', after: { playbook: p.key } });
    return { settings: a.settings, automations: a.automations.length };
  });

  on('GET', '/api/crm/overview', (c) => { d.requireUser(c, STAFF); return overview({ profiles: profiles(), visits: S().visits, messages: S().messages, campaigns: S().campaigns, settings: settings(), today: today() }); });

  // guests
  on('GET', '/api/crm/customers', (c, _p, q) => {
    d.requireUser(c, STAFF);
    const all = profiles();
    const s = q.get('q')?.trim().toLowerCase(); const digits = s?.replace(/\D/g, '');
    const seg = q.get('segment'); const tag = q.get('tag'); const tier = q.get('tier'); const by = q.get('sort') ?? 'spend';
    const list = all.filter((p) => !p.erasedAt && (!s || p.name.toLowerCase().includes(s) || (!!digits && digits.length >= 3 && (p.phone ?? '').includes(digits.replace(/^0/, ''))) || (p.email ?? '').toLowerCase().includes(s))
      && (!seg || p.segment === seg) && (!tag || p.tags.includes(tag)) && (!tier || p.tier === tier))
      .sort((a, b) => by === 'name' ? a.name.localeCompare(b.name) : by === 'recent' ? (b.stats.lastVisit ?? '').localeCompare(a.stats.lastVisit ?? '') : by === 'visits' ? b.stats.visits - a.stats.visits : by === 'points' ? b.pointsBalance - a.pointsBalance : b.stats.spend365 - a.stats.spend365);
    return { total: list.length, tags: [...new Set(all.flatMap((p) => p.tags))].sort(), customers: list.slice(0, 500).map(summary) };
  });
  on('POST', '/api/crm/customers', (c, _p, _q, b) => {
    d.requireUser(c, STAFF);
    const r = findOrCreate({ ...(b as Record<string, string>), consentSms: b.consentSms === true, source: 'manual' });
    if (!r.created) fail(409, 'A guest with this mobile number already exists');
    d.audit(c, { entity: 'crm_customer', entityId: r.c.id, action: 'create' });
    return { id: r.c.id };
  });
  on('GET', '/api/crm/customers/:id', (c, p) => {
    d.requireUser(c, STAFF);
    const pr = prof(p.id);
    const st = settings();
    return {
      profile: pr, recognition: recognition(pr), settings: { loyalty: st.loyalty, tiers: st.tiers, consentText: st.consentText, categories: st.categories },
      referredBy: pr.referredByEmployeeId ? { id: pr.referredByEmployeeId, name: empName(pr.referredByEmployeeId) ?? '—' } : null,
      visits: S().visits.filter((v) => v.customerId === p.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((v) => ({ ...v, serverName: empName(v.serverEmployeeId) })),
      points: S().points.filter((x) => x.customerId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reservations: S().reservations.filter((r) => r.customerId === p.id).sort((a, b) => b.date.localeCompare(a.date)).map((r) => ({ ...r, hostName: empName(r.hostEmployeeId), promoterName: empName(r.promoterEmployeeId) })),
      messages: S().messages.filter((m) => m.customerId === p.id),
      consentEvents: S().consentEvents.filter((e) => e.customerId === p.id),
    };
  });
  on('PATCH', '/api/crm/customers/:id', (c, p, _q, b) => {
    d.requireUser(c, STAFF);
    const x = cust(p.id);
    if (x.erasedAt) fail(400, 'This guest was erased');
    if ('phone' in b) {
      const phone = b.phone ? normalizePhone(String(b.phone)) : null;
      if (b.phone && !phone) fail(400, 'That does not look like a mobile number');
      if (phone && S().customers.some((o) => o.phone === phone && o.id !== x.id)) fail(409, 'Another guest already has this number');
      x.phone = phone;
    }
    for (const k of ['firstName', 'lastName', 'birthday', 'tags', 'preferences', 'referredByEmployeeId'] as const) if (k in b) (x as unknown as Record<string, unknown>)[k] = b[k];
    if ('email' in b) x.email = (b.email as string) || null;
    d.audit(c, { entity: 'crm_customer', entityId: x.id, action: 'update', after: b });
    return { ok: true };
  });
  on('POST', '/api/crm/customers/:id/consent', (c, p, _q, b) => { d.requireUser(c, STAFF); setConsent(p.id, b.channel as Channel, !!b.granted, String(b.source ?? 'admin')); return { consent: cust(p.id).consent }; });
  on('POST', '/api/crm/customers/:id/visits', (c, p, _q, b) => {
    d.requireUser(c, STAFF);
    if (cust(p.id).erasedAt) fail(400, 'This guest was erased');
    if (!(Number(b.amount) >= 0)) fail(400, 'Validation failed — amount');
    const r = recordVisit({ customerId: p.id, amount: Number(b.amount), categories: b.categories as string[] | undefined, note: (b.note as string) ?? null, source: 'counter' });
    return { visitId: r.visit.id, pointsEarned: r.points, balance: balance(p.id) };
  });
  on('POST', '/api/crm/customers/:id/redeem', (c, p, _q, b) => {
    d.requireUser(c, STAFF);
    const reward = settings().loyalty.rewards.find((r) => r.key === b.rewardKey) ?? fail(404, 'Reward not found');
    const bal = balance(p.id);
    if (bal < reward.points) fail(409, `Not enough points: ${bal} of ${reward.points}`);
    S().points.push({ id: d.uid(), customerId: p.id, visitId: null, kind: 'redeem', points: -reward.points, rewardKey: reward.key, note: reward.name, createdAt: nowIso(), date: today() });
    d.audit(c, { entity: 'crm_customer', entityId: p.id, action: 'redeem', after: { reward: reward.name } });
    return { reward, balance: bal - reward.points };
  });
  on('POST', '/api/crm/customers/:id/points', (c, p, _q, b) => {
    d.requireUser(c, ADMIN);
    const n = Math.trunc(Number(b.points));
    if (!n) fail(400, 'Validation failed — points: Non-zero');
    if (typeof b.reason !== 'string' || b.reason.trim().length < 3) fail(400, 'Validation failed — reason: Please give a reason (min 3 characters)');
    cust(p.id);
    S().points.push({ id: d.uid(), customerId: p.id, visitId: null, kind: 'adjust', points: n, rewardKey: null, note: String(b.reason), createdAt: nowIso(), date: today() });
    d.audit(c, { entity: 'crm_customer', entityId: p.id, action: 'points_adjust', after: { points: n }, reason: String(b.reason) });
    return { balance: balance(p.id) };
  });
  on('GET', '/api/crm/customers/:id/export', (c, p) => {
    d.requireUser(c, ADMIN);
    const x = cust(p.id);
    return exportCustomer({ customer: x, visits: S().visits.filter((v) => v.customerId === x.id), points: S().points.filter((v) => v.customerId === x.id), reservations: S().reservations.filter((v) => v.customerId === x.id), messages: S().messages.filter((v) => v.customerId === x.id), consentEvents: S().consentEvents.filter((e) => e.customerId === x.id), business: d.business(), exportedAt: nowIso() });
  });
  on('POST', '/api/crm/customers/:id/erase', (c, p, _q, b) => {
    d.requireUser(c, ADMIN);
    if (typeof b.reason !== 'string' || b.reason.trim().length < 3) fail(400, 'Validation failed — reason: Please give a reason (min 3 characters)');
    const x = cust(p.id);
    Object.assign(x, structuredClone(ERASED_FIELDS), { erasedAt: nowIso() });
    for (const m of S().messages) if (m.customerId === x.id) { m.to = '[erased]'; m.body = '[erased]'; }
    for (const r of S().reservations) if (r.customerId === x.id) r.notes = null;
    d.audit(c, { entity: 'crm_customer', entityId: x.id, action: 'erase' });
    return { ok: true };
  });

  // counter
  on('GET', '/api/crm/lookup', (c, _p, q) => {
    d.requireUser(c, STAFF);
    const phone = normalizePhone(q.get('phone') ?? '');
    if (!phone) return { found: false, phone: null, valid: false };
    const pr = profiles().find((x) => x.phone === phone && !x.erasedAt);
    if (!pr) return { found: false, phone, valid: true, consentText: consentText() };
    return { found: true, phone, valid: true, profile: summary(pr), recognition: recognition(pr), preferences: pr.preferences, rewards: pr.rewards, nextReward: pr.nextReward, consentText: consentText() };
  });
  on('POST', '/api/crm/checkin', (c, _p, _q, b) => {
    d.requireUser(c, STAFF);
    const amount = Number(b.amount ?? 0);
    if (!(amount >= 0)) fail(400, 'Validation failed — amount');
    const g = findOrCreate({ phone: String(b.phone ?? ''), firstName: b.firstName as string | undefined, source: 'counter', consentSms: b.consentSms === true });
    if (g.c.erasedAt) fail(400, 'This number belongs to an erased profile');
    const v = amount > 0 ? recordVisit({ customerId: g.c.id, amount, categories: b.categories as string[] | undefined, source: 'counter', externalRef: (b.receiptNo as string) || null }) : null;
    const pr = prof(g.c.id);
    return { customerId: pr.id, created: g.created, duplicate: v?.duplicate ?? false, pointsEarned: v?.points ?? 0, profile: summary(pr), recognition: recognition(pr), rewards: pr.rewards, nextReward: pr.nextReward, loyaltyName: settings().loyalty.name };
  });

  // reservations
  on('GET', '/api/crm/reservations', (c, _p, q) => {
    d.requireUser(c, STAFF);
    const from = q.get('from') ?? q.get('date') ?? today(); const to = q.get('to') ?? q.get('date') ?? today();
    const all = profiles(); const byId = new Map(all.map((x) => [x.id, x]));
    const list = S().reservations.filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.arrivalTime ?? '').localeCompare(b.arrivalTime ?? ''));
    const live = list.filter((r) => r.status !== 'cancelled');
    return {
      date: from, today: today(),
      reservations: list.map((r) => { const g = byId.get(r.customerId)!; return { ...r, guest: summary(g), recognition: recognition(g), preferences: g.preferences, hostName: empName(r.hostEmployeeId), promoterName: empName(r.promoterEmployeeId) }; }),
      totals: { bookings: live.length, guests: live.reduce((a, r) => a + r.partySize, 0), minSpend: live.reduce((a, r) => a + r.minSpend, 0), arrived: list.filter((r) => r.status === 'arrived' || r.status === 'completed').length, noShows: list.filter((r) => r.status === 'no_show').length },
    };
  });
  on('POST', '/api/crm/reservations', (c, _p, _q, b) => {
    d.requireUser(c, STAFF);
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) fail(400, 'Validation failed — date');
    const customerId = (b.customerId as string) ?? findOrCreate({ phone: b.phone as string, firstName: b.firstName as string, lastName: b.lastName as string, source: 'reservation', consentSms: b.consentSms === true, referredByEmployeeId: (b.promoterEmployeeId as string) ?? null }).c.id;
    const r: ReservationRow = { id: d.uid(), customerId, date: b.date as string, arrivalTime: (b.arrivalTime as string) ?? null, partySize: Number(b.partySize ?? 2), tableArea: (b.tableArea as string) ?? null, minSpend: Number(b.minSpend ?? 0), deposit: Number(b.deposit ?? 0), status: (b.status as ReservationStatus) ?? 'confirmed', hostEmployeeId: (b.hostEmployeeId as string) ?? null, promoterEmployeeId: (b.promoterEmployeeId as string) ?? null, notes: (b.notes as string) ?? null, actualSpend: null, createdAt: nowIso() };
    S().reservations.push(r);
    d.audit(c, { entity: 'crm_reservation', entityId: r.id, action: 'create' });
    return { id: r.id, customerId };
  });
  on('PATCH', '/api/crm/reservations/:id', (c, p, _q, b) => {
    d.requireUser(c, STAFF);
    const r = S().reservations.find((x) => x.id === p.id) ?? fail(404, 'Reservation not found');
    const { categories, ...fields } = b as Record<string, unknown> & { categories?: string[] };
    Object.assign(r, fields);
    let pointsEarned = 0;
    if (b.status === 'completed' && (r.actualSpend ?? 0) > 0) pointsEarned = recordVisit({ customerId: r.customerId, amount: r.actualSpend!, categories: categories ?? ['table'], source: 'reservation', externalRef: r.id, reservationId: r.id, serverEmployeeId: r.hostEmployeeId, note: r.tableArea }).points;
    d.audit(c, { entity: 'crm_reservation', entityId: r.id, action: 'update', after: b });
    return { ok: true, pointsEarned };
  });
  on('GET', '/api/crm/attribution', (c, _p, q) => {
    d.requireUser(c, STAFF);
    const to = q.get('to') ?? today(); const from = q.get('from') ?? DateTime.fromISO(to).minus({ days: 29 }).toISODate()!;
    const people = new Map<string, { employeeId: string; role: 'promoter' | 'host'; bookings: number; guests: number; arrived: number; noShows: number; spend: number; minSpend: number; newGuests: number }>();
    for (const r of S().reservations.filter((x) => x.date >= from && x.date <= to)) for (const [eid, role] of [[r.promoterEmployeeId, 'promoter'], [r.hostEmployeeId, 'host']] as const) {
      if (!eid) continue;
      const k = `${role}:${eid}`; const x = people.get(k) ?? { employeeId: eid, role, bookings: 0, guests: 0, arrived: 0, noShows: 0, spend: 0, minSpend: 0, newGuests: 0 };
      if (r.status !== 'cancelled') { x.bookings++; x.guests += r.partySize; x.minSpend += r.minSpend; }
      if (r.status === 'arrived' || r.status === 'completed') x.arrived++;
      if (r.status === 'no_show') x.noShows++;
      x.spend += r.actualSpend ?? 0; people.set(k, x);
    }
    for (const pr of profiles()) if (pr.referredByEmployeeId && pr.stats.firstVisit && pr.stats.firstVisit >= from && pr.stats.firstVisit <= to) { const x = people.get(`promoter:${pr.referredByEmployeeId}`); if (x) x.newGuests++; }
    return { from, to, people: [...people.values()].map((x) => ({ ...x, name: empName(x.employeeId) ?? '—' })).sort((a, b) => b.spend - a.spend) };
  });

  // campaigns
  on('POST', '/api/crm/campaigns/preview', (c, _p, _q, b) => {
    d.requireUser(c, STAFF);
    const st = settings(); const ch = (b.channel as Channel) ?? 'sms';
    const a = selectAudience(profiles(), (b.filter ?? {}) as AudienceFilter, ch, 'marketing', today());
    const reasons: Record<string, number> = {};
    for (const x of a.excluded) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
    const hp = typeof b.holdoutPct === 'number' ? b.holdoutPct : st.holdoutPct;
    const samples = a.eligible.slice(0, 3).map((x) => planMessage(x, { template: (b.template as string) || '…', channel: ch, purpose: 'marketing', business: d.business(), settings: st })).filter((m) => !('skip' in m)) as PlannedMessage[];
    const parts = samples[0]?.parts ?? (b.template ? smsParts(String(b.template)).parts : 1);
    const toSend = Math.round(a.eligible.length * (1 - hp / 100));
    return { matched: a.matched, eligible: a.eligible.length, excluded: reasons, holdout: a.eligible.length - toSend, toSend, parts, estCost: r2(toSend * parts * st.costPerSms), samples: samples.map((m) => ({ body: m.body, parts: m.parts })), quiet: quiet() };
  });
  const campRow = (x: CampaignRow) => ({ ...x, holdoutIds: undefined, holdout: x.holdoutIds.length, messages: S().messages.filter((m) => m.campaignId === x.id).length, result: campaignResult(x, S().messages, S().visits, settings(), today()) });
  on('GET', '/api/crm/campaigns', (c) => { d.requireUser(c, STAFF); return [...S().campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(campRow); });
  on('GET', '/api/crm/campaigns/:id', (c, p) => { d.requireUser(c, STAFF); return campRow(S().campaigns.find((x) => x.id === p.id) ?? fail(404, 'Campaign not found')); });
  on('POST', '/api/crm/campaigns', (c, _p, _q, b) => {
    d.requireUser(c, STAFF);
    if (typeof b.template !== 'string' || b.template.trim().length < 5) fail(400, 'Validation failed — template');
    const x: CampaignRow = { id: d.uid(), name: String(b.name || 'Untitled campaign'), channel: (b.channel as Channel) ?? 'sms', template: b.template as string, filter: (b.filter ?? {}) as AudienceFilter, holdoutPct: typeof b.holdoutPct === 'number' ? b.holdoutPct : settings().holdoutPct, status: 'draft', sentAt: null, holdoutIds: [], attributionDays: settings().attributionDays, createdAt: nowIso() };
    S().campaigns.push(x);
    return { id: x.id };
  });
  on('DELETE', '/api/crm/campaigns/:id', (c, p) => {
    d.requireUser(c, STAFF);
    const x = S().campaigns.find((y) => y.id === p.id && y.status === 'draft') ?? fail(400, 'Only draft campaigns can be deleted');
    S().campaigns = S().campaigns.filter((y) => y !== x);
    return { ok: true };
  });
  on('POST', '/api/crm/campaigns/:id/send', (c, p, _q, b) => {
    d.requireUser(c, ADMIN);
    const x = S().campaigns.find((y) => y.id === p.id) ?? fail(404, 'Campaign not found');
    if (x.status !== 'draft') fail(409, 'This campaign was already sent');
    if (quiet() && !b.force) fail(409, `It is quiet hours (${settings().quietHours.start}:00–${settings().quietHours.end}:00). Schedule for later or send anyway.`);
    const a = selectAudience(profiles(), x.filter, x.channel, 'marketing', today());
    x.holdoutIds = a.eligible.filter((g) => inHoldout(g.id, x.id, x.holdoutPct)).map((g) => g.id);
    const held = new Set(x.holdoutIds);
    const planned = a.eligible.filter((g) => !held.has(g.id)).map((g) => planMessage(g, { template: x.template, channel: x.channel, purpose: 'marketing', business: d.business(), settings: settings() }))
      .filter((m): m is PlannedMessage => !('skip' in m)).map((m) => ({ ...m, campaignId: x.id }));
    x.status = 'sent'; x.sentAt = nowIso();
    const r = send(planned);
    d.audit(c, { entity: 'crm_campaign', entityId: x.id, action: 'send', after: { sent: r.sent, holdout: x.holdoutIds.length } });
    return { ...r, holdout: x.holdoutIds.length };
  });

  // automations & outbox
  on('GET', '/api/crm/automations', (c) => {
    d.requireUser(c, STAFF);
    const plan = planAuto();
    const cutoff = Date.now() - 30 * 86_400_000;
    return {
      quiet: quiet(), triggers: TRIGGERS,
      automations: [...S().automations].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => ({ ...a, dueToday: plan.messages.filter((m) => m.automationKey === a.key).length, blockedToday: plan.skipped.filter((m) => m.automationKey === a.key).length, sent30: S().messages.filter((m) => m.automationKey === a.key && Date.parse(m.createdAt) > cutoff).length })),
      preview: plan.messages.slice(0, 20).map((m) => ({ automationName: m.automationName, to: m.to, body: m.body })),
    };
  });
  on('PATCH', '/api/crm/automations/:id', (c, p, _q, b) => {
    d.requireUser(c, ADMIN);
    const a = S().automations.find((x) => x.id === p.id) ?? fail(404, 'Automation not found');
    for (const k of ['enabled', 'name', 'template', 'days', 'filter'] as const) if (k in b) (a as unknown as Record<string, unknown>)[k] = b[k];
    if ('bonusPoints' in b) a.bonusPoints = (b.bonusPoints as number | null) ?? undefined;
    return a;
  });
  on('POST', '/api/crm/automations/run', (c, _p, _q, b) => {
    d.requireUser(c, ADMIN);
    // Expire old points first, like the hourly server loop.
    const st = settings();
    if (st.loyalty.expiryDays) for (const cu of S().customers) { const n = expiringPoints(S().points.filter((x) => x.customerId === cu.id), today(), st.loyalty.expiryDays); if (n > 0) S().points.push({ id: d.uid(), customerId: cu.id, visitId: null, kind: 'expire', points: -n, rewardKey: null, note: `Expired after ${st.loyalty.expiryDays} days`, createdAt: nowIso(), date: today() }); }
    const plan = planAuto();
    const dry = b.dryRun !== false;
    const r = dry || (quiet() && !b.force) ? null : send(plan.messages);
    if (r) for (const a of S().automations) a.lastRunAt = nowIso();
    return { quiet: quiet(), sent: r?.sent ?? 0, planned: plan.messages.length, skipped: plan.skipped.length, provider: r?.provider ?? null, messages: plan.messages.slice(0, 50).map((m) => ({ automationName: m.automationName, to: m.to, body: m.body })) };
  });
  on('GET', '/api/crm/messages', (c) => {
    d.requireUser(c, STAFF);
    return [...S().messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map((m) => {
      const g = m.customerId ? S().customers.find((x) => x.id === m.customerId) : null;
      return { ...m, guestName: g ? `${g.firstName} ${g.lastName}`.trim() || 'Guest' : 'Guest', campaignName: S().campaigns.find((x) => x.id === m.campaignId)?.name ?? null };
    });
  });
  on('POST', '/api/crm/pos/transactions', (c, _p, _q, b) => {
    d.requireDevice(c);
    if (!b.phone) return { identified: false };
    const g = findOrCreate({ phone: String(b.phone), firstName: b.firstName as string | undefined, source: 'pos', consentSms: b.consentSms === true });
    const v = recordVisit({ customerId: g.c.id, amount: Number(b.amount ?? 0), categories: b.categories as string[] | undefined, source: 'pos', externalRef: String(b.receiptNo ?? '') || null, at: (b.occurredAt as string) ?? undefined });
    return { identified: true, customerId: g.c.id, created: g.created, duplicate: v.duplicate, pointsEarned: v.points, balance: balance(g.c.id) };
  });
  on('GET', '/api/crm/meta', (c) => { d.requireUser(c, STAFF); return { channels: CHANNELS, segments: SEGMENTS, triggers: TRIGGERS }; });
}

/** Read-only CRM tools for the demo's AI chat. */
export function crmAiTools(crm: () => CrmStore, tz: string) {
  const data = () => { const st = crmWithDefaults(crm().settings); const today = todayFor(tz, st.dayStartHour); return { st, today, profiles: buildProfiles({ ...crm(), settings: st, today }) }; };
  return [
    { name: 'get_crm_overview', description: 'Guest CRM snapshot: guests, consent rate, last-30-day guest revenue vs previous 30, repeat rate, RFM segments, tiers, monthly new vs returning, cohort retention, campaign lift vs holdout, overdue VIPs, top guests.', execute: () => { const x = data(); return overview({ profiles: x.profiles, visits: crm().visits, messages: crm().messages, campaigns: crm().campaigns, settings: x.st, today: x.today }); } },
    { name: 'find_guests', description: 'Search guests by name, segment (champion, loyal, cant_lose, at_risk, new, promising, need_attention, hibernating, lost, no_visits) or tag. Returns spend, visits, tier, tags, points and SMS consent. No phone numbers.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, segment: { type: 'string' }, tag: { type: 'string' } } },
      execute: (i: Record<string, unknown>) => { const q = typeof i.query === 'string' ? i.query.toLowerCase() : null; return data().profiles.filter((p) => !p.erasedAt && (!q || p.name.toLowerCase().includes(q)) && (!i.segment || p.segment === i.segment) && (!i.tag || p.tags.includes(String(i.tag)))).sort((a, b) => b.stats.spend365 - a.stats.spend365).slice(0, 30).map((p) => ({ name: p.name, tier: p.tier, segment: p.segment, tags: p.tags, visits: p.stats.visits, spend365: p.stats.spend365, lastVisit: p.stats.lastVisit, overdue: p.stats.overdue, points: p.pointsBalance, canMarketSms: p.marketable.sms, summary: recognition(p) })); } },
    { name: 'get_campaign_results', description: 'Campaigns with measured results vs the holdout group: conversion rates, lift, incremental revenue, cost, ROI, confidence.', execute: () => { const x = data(); return crm().campaigns.map((c) => ({ name: c.name, status: c.status, sentAt: c.sentAt, result: campaignResult(c, crm().messages, crm().visits, x.st, x.today) })); } },
  ];
}
