import { describe, expect, it } from 'vitest';
import {
  autoTags, campaignLift, canMessage, cohortRetention, customerStats, daysToBirthday, dueAutomation, expiringPoints, finalizeMessage,
  inHoldout, inQuietHours, isOptOutReply, pointsForVisit, renderTemplate, rfm, selectAudience, smsParts, tierFor,
  type AutomationDef, type LoyaltyProgram, type ProfileLike, type VisitLike,
} from './engine.js';
import { formatPhone, maskPhone, normalizePhone } from './phone.js';
import { applyPlaybook, crmWithDefaults, DEFAULT_CRM, PLAYBOOKS } from './playbooks.js';
import { buildProfiles, businessDate, exportCustomer, overview, planAutomations, recognition, type CustomerRow, type VisitRow } from './core.js';

const T = '2026-11-20';
const visits = (id: string, dates: [string, number, string[]?][]): VisitLike[] => dates.map(([date, amount, categories]) => ({ customerId: id, date, amount, categories }));

describe('phone numbers (PH)', () => {
  it('normalizes every way people write a mobile number to E.164', () => {
    for (const x of ['09171234567', '0917 123 4567', '0917-123-4567', '9171234567', '+63 917 123 4567', '639171234567', '0063 917 123 4567']) expect(normalizePhone(x)).toBe('+639171234567');
  });
  it('rejects landlines and junk, accepts foreign numbers with a country code', () => {
    expect(normalizePhone('(02) 8123 4567')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('+65 9123 4567')).toBe('+6591234567');
    expect(formatPhone('+639171234567')).toBe('0917 123 4567');
    expect(maskPhone('+639171234567')).toBe('0917 ••• 4567');
  });
});

describe('guest stats, tiers, tags and RFM', () => {
  const v = visits('a', [['2026-08-01', 5000, ['bottle']], ['2026-08-15', 8000, ['bottle', 'shisha']], ['2026-09-01', 30000, ['bottle']], ['2026-09-10', 4000]]);
  const s = customerStats(v, T);
  it('computes spend, rhythm and overdue', () => {
    expect([s.visits, s.spend, s.spend365, s.maxSpend, s.lastVisit, s.daysSinceLastVisit]).toEqual([4, 47000, 47000, 30000, '2026-09-10', 71]);
    expect(s.avgGapDays).toBe(14); // gaps 14, 17, 9 → median 14
    expect(s.overdue).toBe(true);
    expect(s.categories).toEqual({ bottle: 3, shisha: 1 });
  });
  it('places guests in tiers and applies auto-tag rules', () => {
    expect(tierFor(DEFAULT_CRM.tiers, s.spend365)?.name).toBe('Silver');
    const tags = autoTags(DEFAULT_CRM.tagRules, { stats: s, today: T, birthday: '11-25' });
    expect(tags).toEqual(expect.arrayContaining(['Big spender', 'Bottle buyer', 'Lapsed', 'Birthday soon']));
    expect(tags).not.toContain('VIP');
    expect(tags).not.toContain('Shisha lover');
  });
  it('segments by recency / frequency / monetary', () => {
    expect(rfm(s, 10000).segment).toBe('at_risk');
    const champ = customerStats(visits('b', Array.from({ length: 14 }, (_, i) => [`2026-${String(6 + Math.floor(i / 3)).padStart(2, '0')}-${String(1 + (i % 3) * 9).padStart(2, '0')}`, 9000] as [string, number])).concat([{ customerId: 'b', date: '2026-11-18', amount: 9000 }]), T);
    expect(rfm(champ, 10000).segment).toBe('champion');
    expect(rfm(customerStats(visits('c', [['2026-11-15', 800]]), T), 10000).segment).toBe('new');
    expect(rfm(customerStats([], T), 1).segment).toBe('no_visits');
  });
  it('handles birthdays across the year end and Feb 29', () => {
    expect(daysToBirthday('11-20', T)).toBe(0);
    expect(daysToBirthday('01-02', T)).toBe(43);
    expect(daysToBirthday('02-29', '2027-02-27')).toBe(1);
  });
});

describe('loyalty', () => {
  const spend: LoyaltyProgram = { ...DEFAULT_CRM.loyalty, earn: { kind: 'spend', pesosPerPoint: 100 } };
  const visit: LoyaltyProgram = { ...DEFAULT_CRM.loyalty, earn: { kind: 'visit', points: 1, minSpend: 120 } };
  it('earns per peso or per qualifying visit, with tier multiplier', () => {
    expect(pointsForVisit(spend, 4599)).toBe(45);
    expect(pointsForVisit(spend, 4599, 1.5)).toBe(67);
    expect(pointsForVisit(visit, 119)).toBe(0);
    expect(pointsForVisit(visit, 180)).toBe(1);
    expect(pointsForVisit({ ...spend, enabled: false }, 5000)).toBe(0);
  });
  it('expires only unspent points older than the limit, oldest first', () => {
    const ledger = [{ date: '2025-10-01', points: 100, kind: 'earn' as const }, { date: '2026-03-01', points: 50, kind: 'earn' as const }, { date: '2026-04-01', points: -60, kind: 'redeem' as const }];
    expect(expiringPoints(ledger, T, 365)).toBe(40);
    expect(expiringPoints(ledger, T, null)).toBe(0);
    expect(expiringPoints([...ledger, { date: T, points: -40, kind: 'expire' }], T, 365)).toBe(0);
  });
});

describe('consent and messages', () => {
  const c = { phone: '+639171234567', email: null, consent: {} };
  it('requires a recorded opt-in for marketing but not for transactional messages', () => {
    expect(canMessage(c, 'sms', 'marketing')).toEqual({ ok: false, reason: 'No marketing consent' });
    expect(canMessage(c, 'sms', 'transactional').ok).toBe(true);
    expect(canMessage({ ...c, consent: { sms: { granted: false, at: T, source: 'sms_stop' } } }, 'sms', 'marketing').reason).toBe('Opted out');
    expect(canMessage({ ...c, consent: { sms: { granted: true, at: T, source: 'counter' } } }, 'sms', 'marketing').ok).toBe(true);
    expect(canMessage({ ...c, erasedAt: T }, 'sms', 'transactional').ok).toBe(false);
  });
  it('recognises STOP replies in English and Filipino', () => {
    for (const x of ['STOP', 'stop please', 'Unsubscribe', 'HINTO', 'ayoko na']) expect(isOptOutReply(x)).toBe(true);
    expect(isOptOutReply('Book a table for 6')).toBe(false);
  });
  it('renders templates, adds sender + opt-out, counts SMS parts', () => {
    const body = finalizeMessage(renderTemplate('Hi {{firstName}}, you have {{points}} points.', { firstName: 'Ana', business: 'MDC', points: 120 }), 'marketing', 'sms', 'MDC');
    expect(body).toBe('MDC: Hi Ana, you have 120 points. Reply STOP to opt out.');
    expect(smsParts('a'.repeat(160)).parts).toBe(1);
    expect(smsParts('a'.repeat(161)).parts).toBe(2);
    expect(smsParts('Promo ₱500 off').encoding).toBe('UCS-2');
  });
  it('respects quiet hours across midnight', () => {
    expect([22, 2, 8, 9, 15].map((h) => inQuietHours(h, { start: 21, end: 9 }))).toEqual([true, true, true, false, false]);
  });
});

describe('audiences, holdout and lift', () => {
  const profile = (id: string, over: Partial<ProfileLike> = {}): ProfileLike => ({
    id, phone: '+639170000000', consent: { sms: { granted: true, at: T, source: 'counter' } }, stats: customerStats(visits(id, [['2026-10-01', 2000]]), T),
    segment: 'need_attention', tier: 'Member', tags: [], pointsBalance: 0, ...over,
  });
  it('filters and excludes guests without consent', () => {
    const r = selectAudience([profile('a'), profile('b', { consent: {} }), profile('c', { tags: ['VIP'] })], { minVisits: 1 }, 'sms', 'marketing', T);
    expect([r.matched, r.eligible.length, r.excluded]).toEqual([3, 2, [{ id: 'b', reason: 'No marketing consent' }]]);
    expect(selectAudience([profile('a'), profile('c', { tags: ['VIP'] })], { tags: ['VIP'] }, 'sms', 'marketing', T).eligible.map((p) => p.id)).toEqual(['c']);
  });
  it('assigns a stable holdout of about the requested size', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `cust-${i}`);
    const held = ids.filter((id) => inHoldout(id, 'camp-1', 10)).length;
    expect(held).toBeGreaterThan(150);
    expect(held).toBeLessThan(250);
    expect(inHoldout('cust-7', 'camp-1', 10)).toBe(inHoldout('cust-7', 'camp-1', 10));
  });
  it('measures incremental revenue against the holdout', () => {
    const treated = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const holdout = Array.from({ length: 10 }, (_, i) => `h${i}`);
    const vs: VisitLike[] = [
      ...treated.slice(0, 8).map((id) => ({ customerId: id, date: '2026-11-05', amount: 1000 })),
      ...holdout.slice(0, 2).map((id) => ({ customerId: id, date: '2026-11-06', amount: 1000 })),
      { customerId: 't0', date: '2026-10-30', amount: 99999 }, // before the send: ignored
    ];
    const r = campaignLift({ treatedIds: treated, holdoutIds: holdout, sentOn: '2026-11-01', windowDays: 14, visits: vs, cost: 20, today: T });
    expect([r.treated.rate, r.holdout.rate, r.liftPts, r.incrementalRevenue, r.roi, r.complete]).toEqual([40, 20, 20, 4000, 200, true]);
    expect(r.confidence).toBe('likely'); // 20 vs 10 guests is not enough to call it proven
    const big = (n: number, k: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`).map((id, i) => ({ id, back: i < k }));
    const t = big(400, 160, 't'); const h = big(100, 20, 'h');
    const vs2 = [...t, ...h].filter((x) => x.back).map((x) => ({ customerId: x.id, date: '2026-11-05', amount: 1000 }));
    const r2 = campaignLift({ treatedIds: t.map((x) => x.id), holdoutIds: h.map((x) => x.id), sentOn: '2026-11-01', windowDays: 14, visits: vs2, cost: 400, today: T });
    expect([r2.confidence, r2.verdict.startsWith('Proven')]).toEqual(['proven', true]);
    expect(campaignLift({ treatedIds: ['a'], holdoutIds: [], sentOn: T, windowDays: 14, visits: [], cost: 1, today: T }).liftPts).toBeNull();
  });
  it('computes cohort retention', () => {
    const vs = [...visits('a', [['2026-08-01', 1], ['2026-08-20', 1]]), ...visits('b', [['2026-08-03', 1]])];
    expect(cohortRetention([{ customerId: 'a', first: '2026-08-01' }, { customerId: 'b', first: '2026-08-03' }], vs, T)).toEqual([{ month: '2026-08', guests: 2, d30: 50, d60: 50, d90: 50 }]);
  });
});

describe('automations', () => {
  const auto = (trigger: AutomationDef['trigger'], days = 0, filter = {}): AutomationDef => ({ key: trigger, name: trigger, trigger, enabled: true, channel: 'sms', days, filter, template: 'x' });
  const p = (id: string, v: [string, number][], over: Partial<ProfileLike> = {}): ProfileLike => ({ id, phone: '+639170000000', consent: {}, stats: customerStats(visits(id, v), T), segment: 'new', tier: null, tags: [], pointsBalance: 0, ...over });
  it('welcome fires once, the day after the first visit', () => {
    const g = p('a', [['2026-11-19', 500]]);
    expect(dueAutomation(auto('welcome', 1), [g], [], T, null)).toHaveLength(1);
    expect(dueAutomation(auto('welcome', 1), [g], [{ automationKey: 'welcome', customerId: 'a', date: T }], T, null)).toHaveLength(0);
  });
  it('win-back fires once per lapse and again after the guest returns and lapses', () => {
    const g = p('a', [['2026-08-01', 500], ['2026-09-01', 500]]);
    expect(dueAutomation(auto('winback', 45), [g], [], T, null)).toHaveLength(1);
    expect(dueAutomation(auto('winback', 45), [g], [{ automationKey: 'winback', customerId: 'a', date: '2026-10-20' }], T, null)).toHaveLength(0);
    expect(dueAutomation(auto('winback', 45), [g], [{ automationKey: 'winback', customerId: 'a', date: '2026-08-20' }], T, null)).toHaveLength(1);
  });
  it('birthday once a year, reward-ready once per visit', () => {
    expect(dueAutomation(auto('birthday', 7), [p('a', [], { birthday: '11-27' })], [], T, null)).toHaveLength(1);
    const rich = p('b', [['2026-11-19', 500]], { pointsBalance: 60 });
    expect(dueAutomation(auto('reward_ready'), [rich], [], T, 50)).toHaveLength(1);
    expect(dueAutomation(auto('reward_ready'), [rich], [{ automationKey: 'reward_ready', customerId: 'b', date: T }], T, 50)).toHaveLength(0);
    expect(dueAutomation(auto('reward_ready'), [p('c', [['2026-09-01', 500]], { pointsBalance: 60 })], [], T, 50)).toHaveLength(0); // no back-catalogue blast
  });
});

describe('playbooks and core', () => {
  it('ships three playbooks and merges partial settings', () => {
    expect(PLAYBOOKS.map((x) => x.key)).toEqual(['nightclub_vip', 'cafe_loyalty', 'shisha_lounge']);
    const s = crmWithDefaults({ senderName: 'MDC', holdoutPct: 20 });
    expect([s.senderName, s.holdoutPct, s.loyalty.earn.kind]).toEqual(['MDC', 20, 'spend']);
    const cafe = applyPlaybook(s, 'cafe_loyalty');
    expect([cafe.settings.senderName, cafe.settings.loyalty.earn.kind, cafe.settings.businessType, cafe.automations.length]).toEqual(['MDC', 'visit', 'cafe', 5]);
  });

  it('builds profiles, plans consent-aware automations, exports data', () => {
    const settings = DEFAULT_CRM;
    const cust = (id: string, consent: boolean, birthday: string | null = null): CustomerRow => ({ id, firstName: id.toUpperCase(), lastName: 'Cruz', phone: '+639171234567', email: null, birthday, source: 'counter', referredByEmployeeId: null, tags: [], preferences: { drinks: 'Hennessy' }, consent: consent ? { sms: { granted: true, at: T, source: 'counter', version: 'v1' } } : {}, erasedAt: null, createdAt: T });
    const vr = (customerId: string, date: string, amount: number): VisitRow => ({ id: `${customerId}${date}`, customerId, occurredAt: `${date}T15:00:00Z`, date, amount, items: 1, categories: ['bottle'], source: 'counter', externalRef: null, reservationId: null, serverEmployeeId: null, pointsEarned: 0 });
    const customers = [cust('ana', true), cust('ben', false), cust('cy', true, '11-27')];
    const vs = [vr('ana', '2026-11-19', 120000), vr('ben', '2026-11-19', 3000), vr('cy', '2026-06-01', 5000), vr('cy', '2026-07-01', 5000)];
    const profiles = buildProfiles({ customers, visits: vs, points: [], reservations: [], settings, today: T });
    const ana = profiles.find((x) => x.id === 'ana')!;
    expect([ana.tier, ana.tags.includes('VIP'), ana.marketable.sms]).toEqual(['Gold', true, true]);
    expect(recognition(ana)).toContain('likes Hennessy');
    const plan = planAutomations({ automations: applyPlaybook(settings, 'nightclub_vip').automations, profiles, sent: [], settings, business: 'MDC', today: T });
    const keys = plan.messages.map((m) => `${m.automationKey}:${m.customerId}`).sort();
    expect(keys).toEqual(['birthday:cy', 'welcome:ana']);
    expect(plan.skipped.some((x) => x.customerId === 'ben' && x.reason === 'No marketing consent')).toBe(true);
    expect(plan.messages.find((m) => m.customerId === 'cy')!.body).toContain('(100 total)');
    const ov = overview({ profiles, visits: vs, messages: [], campaigns: [], settings, today: T });
    expect([ov.guests.total, ov.guests.marketableSms, ov.last30.revenue]).toEqual([3, 2, 123000]);
    const ex = exportCustomer({ customer: customers[0], visits: vs.filter((v) => v.customerId === 'ana'), points: [], reservations: [], messages: [], consentEvents: [], business: 'MDC', exportedAt: T });
    expect(ex.visits).toHaveLength(1);
    expect(businessDate('2026-11-20T18:30:00Z', 'Asia/Manila', 6)).toBe('2026-11-20'); // 2:30 AM Manila → previous night
  });
});

describe('spending performance', () => {
  it('computes concentration, distribution, heat and movers', async () => {
    const { spendingPerformance } = await import('./core.js');
    const cust = (id: string): CustomerRow => ({ id, firstName: id, lastName: '', phone: null, email: null, birthday: null, source: 'pos', referredByEmployeeId: null, tags: [], preferences: {}, consent: {}, erasedAt: null, createdAt: T });
    const v = (customerId: string, date: string, amount: number, hourUtc = 15): VisitRow => ({ id: `${customerId}${date}`, customerId, occurredAt: `${date}T${String(hourUtc).padStart(2, '0')}:00:00Z`, date, amount, items: 1, categories: ['bottle'], source: 'pos', externalRef: null, reservationId: null, serverEmployeeId: null, pointsEarned: 0 });
    const customers = ['a', 'b', 'c', 'd', 'e'].map(cust);
    const visits = [v('a', '2026-11-10', 90000), v('b', '2026-11-12', 4000), v('c', '2026-11-13', 3000), v('d', '2026-11-14', 2000), v('e', '2026-11-15', 1000), v('b', '2026-10-01', 20000)];
    const profiles = buildProfiles({ customers, visits, points: [], reservations: [], settings: DEFAULT_CRM, today: T });
    const s = spendingPerformance({ profiles, visits, today: T, tz: 'Asia/Manila', dayStartHour: 6, days: 30 });
    expect([s.kpis.revenue, s.kpis.customers, s.kpis.top20Share, s.kpis.avgTicket]).toEqual([100000, 5, 90, 20000]);
    expect(s.histogram.find((h) => h.label === '₱50k–100k')!.customers).toBe(1);
    expect(s.pareto.at(-1)).toEqual({ customersPct: 100, revenuePct: 100 });
    expect(s.decliners[0]).toMatchObject({ id: 'b', before: 20000, now: 4000 });
    // 15:00 UTC = 23:00 Manila; 2026-11-10 is a Tuesday → row 1, hour 23 → column 17 when the day starts at 06:00
    expect(s.heat.rows[1][s.heat.hours.indexOf(23)]).toBe(90000);
    expect(s.series).toHaveLength(30);
  });
});
