/**
 * CRM core: composes the pure engine over plain rows. The API loads a tenant's rows from Postgres and the
 * browser demo passes its in-memory store; both get identical answers.
 */
import { DateTime } from 'luxon';
import {
  autoTags, balanceOf, campaignLift, canMessage, cohortRetention, customerStats, daysBetween, daysToBirthday, dueAutomation, finalizeMessage,
  nextReward, nextTier, renderTemplate, rewardsAvailable, rfm, SEGMENTS, smsParts, tierFor,
  type AutomationDef, type Channel, type ConsentState, type CrmSettings, type CustomerStats, type LedgerEntry, type Purpose, type Segment, type SentLog,
} from './engine.js';
import { formatPhone } from './phone.js';

export interface Preferences { drinks?: string; food?: string; seating?: string; allergies?: string; music?: string; notes?: string }
export interface CustomerRow {
  id: string; firstName: string; lastName: string; phone: string | null; email: string | null; birthday: string | null;
  source: string; referredByEmployeeId: string | null; tags: string[]; preferences: Preferences; consent: ConsentState;
  erasedAt: string | null; createdAt: string;
}
export interface VisitRow {
  id: string; customerId: string; occurredAt: string; date: string; amount: number; items: number; categories: string[];
  source: string; externalRef: string | null; reservationId: string | null; serverEmployeeId: string | null; pointsEarned: number; note?: string | null;
}
export interface PointsRow { id: string; customerId: string; visitId: string | null; kind: LedgerEntry['kind']; points: number; rewardKey: string | null; note: string | null; createdAt: string; date: string }
export type ReservationStatus = 'requested' | 'confirmed' | 'arrived' | 'completed' | 'no_show' | 'cancelled';
export interface ReservationRow {
  id: string; customerId: string; date: string; arrivalTime: string | null; partySize: number; tableArea: string | null; minSpend: number;
  deposit: number; status: ReservationStatus; hostEmployeeId: string | null; promoterEmployeeId: string | null; notes: string | null;
  actualSpend: number | null; createdAt: string;
}
export interface MessageRow {
  id: string; customerId: string | null; campaignId: string | null; automationKey: string | null; channel: Channel; purpose: Purpose;
  to: string; body: string; status: 'queued' | 'sent' | 'simulated' | 'failed' | 'skipped'; provider: string; providerRef: string | null;
  error: string | null; parts: number; cost: number; createdAt: string;
}
export interface CampaignRow {
  id: string; name: string; channel: Channel; template: string; filter: import('./engine.js').AudienceFilter; holdoutPct: number;
  status: 'draft' | 'sent'; sentAt: string | null; holdoutIds: string[]; attributionDays: number; createdAt: string;
}

export type Profile = ReturnType<typeof buildProfiles>[number];

/** The business date of a timestamp: a 2 AM bill belongs to the previous night when the day starts at 6 AM. */
export function businessDate(iso: string | Date, tz: string, dayStartHour: number) {
  const dt = typeof iso === 'string' ? DateTime.fromISO(iso, { zone: tz }) : DateTime.fromJSDate(iso, { zone: tz });
  return dt.minus({ hours: dayStartHour }).toISODate()!;
}
export const todayFor = (tz: string, dayStartHour: number, now = new Date()) => businessDate(now, tz, dayStartHour);
export const displayName = (c: { firstName: string; lastName: string; erasedAt?: string | null }) => (c.erasedAt ? 'Erased guest' : `${c.firstName} ${c.lastName}`.trim() || 'Guest');

export function buildProfiles(d: { customers: CustomerRow[]; visits: VisitRow[]; points: PointsRow[]; reservations: ReservationRow[]; settings: CrmSettings; today: string }) {
  const vBy = groupBy(d.visits, (v) => v.customerId);
  const pBy = groupBy(d.points, (p) => p.customerId);
  const rBy = groupBy(d.reservations, (r) => r.customerId);
  const base = d.customers.map((c) => ({ c, stats: customerStats(vBy.get(c.id) ?? [], d.today) }));
  const spends = base.map((b) => b.stats.spend365).filter((x) => x > 0);
  const med = spends.length ? median(spends) : 0;
  return base.map(({ c, stats }) => {
    const res = rBy.get(c.id) ?? [];
    const pointsBalance = balanceOf(pBy.get(c.id) ?? []);
    const bookings = res.filter((r) => r.status !== 'cancelled').length;
    const noShows = res.filter((r) => r.status === 'no_show').length;
    const score = rfm(stats, med);
    const tier = tierFor(d.settings.tiers, stats.spend365);
    const auto = autoTags(d.settings.tagRules, { stats, bookings, noShows, birthday: c.birthday, pointsBalance, today: d.today });
    return {
      id: c.id, name: displayName(c), firstName: c.firstName, lastName: c.lastName, phone: c.phone, phoneDisplay: formatPhone(c.phone), email: c.email,
      birthday: c.birthday, source: c.source, referredByEmployeeId: c.referredByEmployeeId, preferences: c.preferences, consent: c.consent,
      erasedAt: c.erasedAt, createdAt: c.createdAt,
      stats, rfm: { r: score.r, f: score.f, m: score.m }, segment: score.segment as Segment, tier: tier?.name ?? null,
      multiplier: tier?.multiplier ?? 1, nextTier: nextTier(d.settings.tiers, stats.spend365),
      manualTags: c.tags, autoTags: auto, tags: [...new Set([...c.tags, ...auto])],
      pointsBalance, nextReward: nextReward(d.settings.loyalty, pointsBalance), rewards: rewardsAvailable(d.settings.loyalty, pointsBalance),
      bookings, noShows, daysToBirthday: daysToBirthday(c.birthday, d.today),
      marketable: { sms: canMessage(c, 'sms', 'marketing').ok, viber: canMessage(c, 'viber', 'marketing').ok, email: canMessage(c, 'email', 'marketing').ok },
    };
  });
}

/** One-line recognition for the door / counter: what staff should know in 3 seconds. */
export function recognition(p: Profile) {
  const bits: string[] = [];
  if (p.tier && p.multiplier > 1) bits.push(p.tier);
  if (p.tags.includes('VIP')) bits.push('VIP');
  if (p.stats.visits) bits.push(`${p.stats.visits} visit${p.stats.visits > 1 ? 's' : ''}`, `last ${p.stats.daysSinceLastVisit === 0 ? 'today' : `${p.stats.daysSinceLastVisit}d ago`}`, `avg ₱${Math.round(p.stats.avgSpend).toLocaleString('en-PH')}`);
  else bits.push('first visit');
  if (p.preferences.drinks) bits.push(`likes ${p.preferences.drinks}`);
  if (p.preferences.allergies) bits.push(`⚠ ${p.preferences.allergies}`);
  if (p.daysToBirthday !== null && p.daysToBirthday <= 7) bits.push(p.daysToBirthday === 0 ? '🎂 birthday today' : `🎂 birthday in ${p.daysToBirthday}d`);
  return bits.join(' · ');
}

export function overview(d: { profiles: Profile[]; visits: VisitRow[]; messages: MessageRow[]; campaigns: CampaignRow[]; settings: CrmSettings; today: string; venueRevenue?: { from: string; to: string; amount: number } | null }) {
  const live = d.profiles.filter((p) => !p.erasedAt);
  const t = d.today;
  const last = (n: number) => d.visits.filter((v) => daysBetween(v.date, t) < n && v.date <= t);
  const prev = (n: number) => d.visits.filter((v) => { const x = daysBetween(v.date, t); return x >= n && x < n * 2; });
  const v30 = last(30); const v30p = prev(30);
  const sum = (vs: VisitRow[]) => r2(vs.reduce((a, v) => a + v.amount, 0));
  const guests = (vs: VisitRow[]) => new Set(vs.map((v) => v.customerId)).size;
  // Repeat rate: of the guests who visited in the last 90 days, the share with 2+ visits ever.
  const active90 = live.filter((p) => p.stats.daysSinceLastVisit !== null && p.stats.daysSinceLastVisit < 90);
  const repeat = active90.filter((p) => p.stats.visits >= 2).length;
  const segments = Object.keys(SEGMENTS).map((k) => ({ key: k as Segment, label: SEGMENTS[k as Segment].label, advice: SEGMENTS[k as Segment].advice, count: live.filter((p) => p.segment === k).length, spend365: r2(live.filter((p) => p.segment === k).reduce((a, p) => a + p.stats.spend365, 0)) }));
  const tiers = d.settings.tiers.map((x) => ({ name: x.name, count: live.filter((p) => p.tier === x.name).length }));
  const months: { month: string; revenue: number; guests: number; newGuests: number; returning: number }[] = [];
  const firsts = new Map(live.filter((p) => p.stats.firstVisit).map((p) => [p.id, p.stats.firstVisit!]));
  for (let i = 5; i >= 0; i--) {
    const m = DateTime.fromISO(t).minus({ months: i }).toFormat('yyyy-LL');
    const vs = d.visits.filter((v) => v.date.startsWith(m));
    const ids = new Set(vs.map((v) => v.customerId));
    const nw = [...ids].filter((id) => firsts.get(id)?.startsWith(m)).length;
    months.push({ month: m, revenue: sum(vs), guests: ids.size, newGuests: nw, returning: ids.size - nw });
  }
  const sent30 = d.messages.filter((m) => daysBetween(m.createdAt.slice(0, 10), t) < 30 && (m.status === 'sent' || m.status === 'simulated'));
  const watch = live.filter((p) => (p.stats.overdue || p.segment === 'cant_lose') && p.stats.spend365 > 0)
    .sort((a, b) => b.stats.spend365 - a.stats.spend365).slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, tier: p.tier, spend365: p.stats.spend365, daysSinceLastVisit: p.stats.daysSinceLastVisit, usualGap: p.stats.avgGapDays, segment: p.segment }));
  const top = [...live].sort((a, b) => b.stats.spend365 - a.stats.spend365).slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, tier: p.tier, spend365: p.stats.spend365, visits365: p.stats.visits365, lastVisit: p.stats.lastVisit, tags: p.tags }));
  const sms = live.filter((p) => p.marketable.sms).length;
  return {
    today: t,
    guests: { total: live.length, new30: live.filter((p) => p.stats.daysSinceFirstVisit !== null && p.stats.daysSinceFirstVisit < 30).length, active90: active90.length, marketableSms: sms, consentRate: live.length ? Math.round((sms / live.length) * 100) : 0 },
    last30: { revenue: sum(v30), visits: v30.length, guests: guests(v30), avgTicket: v30.length ? r2(sum(v30) / v30.length) : 0 },
    prev30: { revenue: sum(v30p), visits: v30p.length, guests: guests(v30p) },
    repeatRate: active90.length ? Math.round((repeat / active90.length) * 100) : 0,
    identifiedShare: d.venueRevenue && d.venueRevenue.amount > 0 ? Math.min(100, Math.round((sum(d.visits.filter((v) => v.date >= d.venueRevenue!.from && v.date <= d.venueRevenue!.to)) / d.venueRevenue.amount) * 100)) : null,
    segments, tiers, months, cohorts: cohortRetention([...firsts].map(([customerId, first]) => ({ customerId, first })), d.visits, t, 6),
    messages30: { sent: sent30.length, cost: r2(sent30.reduce((a, m) => a + m.cost, 0)) },
    campaigns: d.campaigns.filter((c) => c.status === 'sent').slice(0, 5).map((c) => ({ id: c.id, name: c.name, sentAt: c.sentAt, ...campaignResult(c, d.messages, d.visits, d.settings, t) })),
    watch, top,
  };
}

export function campaignResult(c: CampaignRow, messages: MessageRow[], visits: VisitRow[], settings: CrmSettings, today: string) {
  if (c.status !== 'sent' || !c.sentAt) return null;
  const mine = messages.filter((m) => m.campaignId === c.id && m.customerId && (m.status === 'sent' || m.status === 'simulated'));
  return campaignLift({
    treatedIds: [...new Set(mine.map((m) => m.customerId!))], holdoutIds: c.holdoutIds, sentOn: c.sentAt.slice(0, 10),
    windowDays: c.attributionDays || settings.attributionDays, visits, cost: mine.reduce((a, m) => a + m.cost, 0), today,
  });
}

export interface PlannedMessage { customerId: string; to: string; body: string; parts: number; cost: number; channel: Channel; purpose: Purpose; automationKey?: string; campaignId?: string; bonusPoints?: number }

export function planMessage(p: Profile, o: { template: string; channel: Channel; purpose: Purpose; business: string; settings: CrmSettings; extraPoints?: number }): PlannedMessage | { skip: string } {
  const ok = canMessage(p, o.channel, o.purpose);
  if (!ok.ok) return { skip: ok.reason! };
  const points = p.pointsBalance + (o.extraPoints ?? 0);
  const reward = [...o.settings.loyalty.rewards].sort((a, b) => b.points - a.points).find((r) => r.points <= points);
  const body = finalizeMessage(renderTemplate(o.template, { firstName: p.firstName || 'there', business: o.business, points, tier: p.tier, reward: reward?.name ?? null }), o.purpose, o.channel, o.business);
  const parts = o.channel === 'sms' ? smsParts(body).parts : 1;
  return { customerId: p.id, to: o.channel === 'email' ? p.email! : p.phone!, body, parts, cost: o.channel === 'sms' ? r2(parts * o.settings.costPerSms) : 0, channel: o.channel, purpose: o.purpose };
}

/** Everything the automations would send today. Marketing consent is enforced here. */
export function planAutomations(d: { automations: AutomationDef[]; profiles: Profile[]; sent: SentLog[]; settings: CrmSettings; business: string; today: string }) {
  const cheapest = d.settings.loyalty.enabled && d.settings.loyalty.rewards.length ? Math.min(...d.settings.loyalty.rewards.map((r) => r.points)) : null;
  const out: (PlannedMessage & { automationName: string })[] = [];
  const skipped: { automationKey: string; customerId: string; reason: string }[] = [];
  // At most one automated message per guest per day; automations earlier in the list win.
  const touched = new Set(d.sent.filter((s) => s.date === d.today).map((s) => s.customerId));
  for (const a of d.automations) {
    for (const p of dueAutomation(a, d.profiles, d.sent, d.today, cheapest) as Profile[]) {
      if (touched.has(p.id)) { skipped.push({ automationKey: a.key, customerId: p.id, reason: 'Already messaged today' }); continue; }
      const m = planMessage(p, { template: a.template, channel: a.channel, purpose: 'marketing', business: d.business, settings: d.settings, extraPoints: a.bonusPoints });
      if ('skip' in m) skipped.push({ automationKey: a.key, customerId: p.id, reason: m.skip });
      else { touched.add(p.id); out.push({ ...m, automationKey: a.key, automationName: a.name, bonusPoints: a.bonusPoints }); }
    }
  }
  return { messages: out, skipped };
}

/** Data Privacy Act right of access / portability: everything held about one guest, in plain JSON. */
export function exportCustomer(d: { customer: CustomerRow; visits: VisitRow[]; points: PointsRow[]; reservations: ReservationRow[]; messages: MessageRow[]; consentEvents: unknown[]; business: string; exportedAt: string }) {
  return {
    controller: d.business, exportedAt: d.exportedAt,
    note: 'Personal data held about you, provided under Sections 16–18 of the Data Privacy Act of 2012 (RA 10173).',
    profile: { name: displayName(d.customer), phone: d.customer.phone, email: d.customer.email, birthday: d.customer.birthday, preferences: d.customer.preferences, tags: d.customer.tags, source: d.customer.source, createdAt: d.customer.createdAt },
    consent: d.customer.consent, consentHistory: d.consentEvents,
    visits: d.visits.map((v) => ({ date: v.date, amount: v.amount, items: v.items, categories: v.categories, pointsEarned: v.pointsEarned })),
    points: d.points.map((p) => ({ date: p.date, kind: p.kind, points: p.points, note: p.note })),
    reservations: d.reservations.map((r) => ({ date: r.date, partySize: r.partySize, table: r.tableArea, status: r.status })),
    messages: d.messages.map((m) => ({ date: m.createdAt, channel: m.channel, purpose: m.purpose, body: m.body, status: m.status })),
  };
}

/** Right to erasure: personal fields are wiped; anonymous sales stay for the books and the statistics. */
export const ERASED_FIELDS = { firstName: '', lastName: '', phone: null, email: null, birthday: null, tags: [] as string[], preferences: {} as Preferences, consent: {} as ConsentState, referredByEmployeeId: null };

function groupBy<T>(xs: T[], k: (x: T) => string) { const m = new Map<string, T[]>(); for (const x of xs) { const key = k(x); const a = m.get(key); if (a) a.push(x); else m.set(key, [x]); } return m; }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export type { CustomerStats };
