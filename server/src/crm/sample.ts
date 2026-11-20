/**
 * Sample guests for the demo venue (Mega Dance Center: nightclub + shisha lounge), so both pilot workflows —
 * VIP table guests and high-frequency shisha regulars — can be tried on one CRM. Deterministic for a given seed.
 * All people are fictional.
 */
import { DateTime } from 'luxon';
import { inHoldout, pointsForVisit, renderTemplate, finalizeMessage, smsParts, type CrmSettings } from './engine.js';
import type { CampaignRow, CustomerRow, MessageRow, PointsRow, ReservationRow, VisitRow } from './core.js';
import { TABLES } from '../policy/handbook.js';

const FIRST = ['Paolo', 'Bianca', 'Miguel', 'Andrea', 'Carlo', 'Patricia', 'Rafael', 'Kristine', 'Jerome', 'Camille', 'Joshua', 'Nicole', 'Mark', 'Angelica', 'Christian', 'Danica', 'Ivan', 'Trisha', 'Enzo', 'Bea', 'Gabriel', 'Hazel', 'Luis', 'Jasmine', 'Marco', 'Erika', 'Vince', 'Louise', 'Kenneth', 'Monique', 'Arvin', 'Shaira', 'Jun', 'Maricel', 'Ryan', 'Clarisse', 'Dennis', 'Joanna', 'Raymond', 'Pia', 'Jared', 'Lea', 'Nathan', 'Rica', 'Franco', 'Celine', 'Aldrin', 'Mika', 'Kevin', 'Sofia', 'Hiro', 'Min-jun', 'Daniel', 'Chloe'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Villanueva', 'Ramos', 'Aquino', 'Castillo', 'Navarro', 'Dela Cruz', 'Gonzales', 'Lim', 'Tan', 'Sy', 'Uy', 'Co', 'Chua', 'Fernandez', 'Lopez', 'Rivera', 'Salazar', 'Domingo', 'Pascual', 'Marquez', 'Ocampo', 'Yap', 'Ong', 'Park', 'Tanaka', 'Kim'];
const VIP_DRINKS = ['Hennessy VSOP', 'Johnnie Walker Blue', 'Moët Imperial', 'Grey Goose', 'Don Julio 1942', 'Jameson', 'Ace of Spades', 'Macallan 12', 'Patrón Silver'];
const SHISHA = ['Double apple', 'Mint', 'Blueberry mint', 'Grape', 'Watermelon', 'Love 66', 'Lady Killer', 'Peach ice'];
const SEATS = ['Ultra VIP', 'Mega VIP', 'King VIP', 'Regular VIP', 'near the DJ booth', 'Grey King 1'];

export interface SampleEmployees { promoters: string[]; hosts: string[]; servers: string[]; shisha: string[] }
export interface SampleOut { customers: CustomerRow[]; visits: VisitRow[]; points: PointsRow[]; reservations: ReservationRow[]; campaigns: CampaignRow[]; messages: MessageRow[] }

export function sampleCrm(o: { today: string; tz: string; settings: CrmSettings; emp: SampleEmployees; uid: () => string; business: string; seed?: number }): SampleOut {
  let s = o.seed ?? 7;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const today = DateTime.fromISO(o.today, { zone: o.tz });
  const out: SampleOut = { customers: [], visits: [], points: [], reservations: [], campaigns: [], messages: [] };
  const usedPhones = new Set<string>();
  const phone = () => { let p; do p = `+639${between(15, 99)}${String(between(0, 9_999_999)).padStart(7, '0')}`; while (usedPhones.has(p)); usedPhones.add(p); return p; };
  const atNight = (date: string, hourFrom: number, hourTo: number) => DateTime.fromISO(date, { zone: o.tz }).set({ hour: between(hourFrom, hourTo), minute: between(0, 59) }).plus({ days: 0 });
  const tableMin = (area: string) => Number((TABLES.find((t) => t.area === area)?.consumable ?? '0').replace(/[^\d]/g, '')) || 0;

  type Kind = 'vip' | 'club' | 'shisha' | 'occasional';
  const plan: [Kind, number][] = [['vip', 26], ['club', 64], ['shisha', 72], ['occasional', 110]];
  for (const [kind, n] of plan) {
    for (let i = 0; i < n; i++) {
      const id = o.uid();
      const first = pick(FIRST); const last = pick(LAST);
      const consent = rand() < (kind === 'occasional' ? 0.45 : 0.75);
      const createdDaysAgo = kind === 'occasional' ? between(1, 170) : between(60, 200);
      const created = today.minus({ days: createdDaysAgo });
      const bday = rand() < 0.7 ? (i % 17 === 0 ? today.plus({ days: between(0, 9) }).toFormat('MM-dd') : `${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`) : null;
      const promoter = kind === 'vip' || kind === 'club' ? (rand() < 0.6 ? pick(o.emp.promoters) : null) : null;
      const prefs = kind === 'vip' ? { drinks: pick(VIP_DRINKS), seating: pick(SEATS), notes: rand() < 0.3 ? 'Prefers same VIP host every visit' : undefined, allergies: rand() < 0.1 ? 'Peanuts' : undefined }
        : kind === 'shisha' ? { drinks: pick(['Iced tea', 'San Mig Light', 'Red Horse', 'Mojito']), notes: `Favourite flavour: ${pick(SHISHA)}`, seating: rand() < 0.5 ? 'Lounge sofa by the window' : undefined }
          : kind === 'club' && rand() < 0.4 ? { drinks: pick(['Tower of beer', 'Jägerbomb', 'Bacardi Gold', 'Tequila shots']) } : {};
      out.customers.push({
        id, firstName: first, lastName: last, phone: phone(), email: rand() < 0.35 ? `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + `${between(1, 99)}@example.com` : null,
        birthday: bday, source: kind === 'vip' ? 'reservation' : kind === 'shisha' ? 'counter' : pick(['counter', 'guestlist', 'pos']),
        referredByEmployeeId: promoter, tags: kind === 'vip' && rand() < 0.2 ? ['Celebrity'] : [], preferences: Object.fromEntries(Object.entries(prefs).filter(([, v]) => v)),
        consent: consent ? { sms: { granted: true, at: created.toUTC().toISO()!, source: kind === 'vip' ? 'reservation' : 'counter', version: o.settings.consentVersion } } : {},
        erasedAt: null, createdAt: created.toUTC().toISO()!,
      });

      // Visit rhythm by kind. Some regulars go quiet (lapsed / overdue) to make win-back and VIP alerts real.
      const gap = kind === 'vip' ? between(6, 16) : kind === 'club' ? between(10, 28) : kind === 'shisha' ? between(4, 10) : between(30, 90);
      const stopEarly = rand() < (kind === 'occasional' ? 0.5 : 0.22) ? between(25, 90) : 0;
      let d = created.plus({ days: between(0, 5) });
      const maxVisits = kind === 'occasional' ? between(1, 3) : 40;
      let count = 0;
      while (d <= today.minus({ days: stopEarly }) && count < maxVisits) {
        const date = d.toISODate()!;
        if (date >= o.today) break; // tonight's business is recorded live, not generated
        const weekendBoost = d.weekday >= 5 ? 1.25 : 1;
        let amount: number; let cats: string[]; let res: ReservationRow | null = null;
        if (kind === 'vip') {
          const area = pick(['Regular VIP', 'Mega VIP', 'King VIP', 'Single Ultra VIP', 'Ultra VIP', 'Grey King 1 — full']);
          const min = tableMin(area);
          amount = Math.round(min * (0.9 + rand() * 0.9) / 100) * 100;
          cats = ['table', 'bottle', ...(rand() < 0.4 ? ['champagne'] : []), ...(rand() < 0.3 ? ['shisha'] : []), ...(rand() < 0.4 ? ['ladies drink'] : [])];
          const noShow = rand() < 0.06;
          res = { id: o.uid(), customerId: id, date, arrivalTime: `${between(21, 23)}:${pick(['00', '30'])}`, partySize: between(4, 12), tableArea: area, minSpend: min, deposit: rand() < 0.5 ? Math.round(min * 0.3) : 0,
            status: noShow ? 'no_show' : 'completed', hostEmployeeId: pick(o.emp.hosts), promoterEmployeeId: promoter, notes: null, actualSpend: noShow ? null : amount, createdAt: d.minus({ days: between(0, 4) }).toUTC().toISO()! };
          out.reservations.push(res);
          if (noShow) { d = d.plus({ days: Math.max(2, Math.round(gap * (0.6 + rand() * 0.8))) }); continue; }
        } else if (kind === 'club') {
          amount = Math.round((1500 + rand() * 6500) * weekendBoost / 50) * 50;
          cats = [pick(['beer', 'cocktails', 'bottle']), ...(rand() < 0.3 ? ['shisha'] : []), ...(rand() < 0.2 ? ['food'] : [])];
        } else if (kind === 'shisha') {
          amount = Math.round((650 + rand() * 1700) / 10) * 10;
          cats = ['shisha', ...(rand() < 0.5 ? ['refill'] : []), ...(rand() < 0.6 ? ['drinks'] : []), ...(rand() < 0.25 ? ['premium flavour'] : [])];
        } else {
          amount = Math.round((800 + rand() * 4000) / 50) * 50;
          cats = [pick(['beer', 'cocktails', 'shisha', 'food'])];
        }
        const at = kind === 'shisha' ? atNight(date, 19, 23) : atNight(date, 22, 23).plus({ hours: between(0, 4) });
        if (at > DateTime.now().setZone(o.tz)) break;
        const visitId = o.uid();
        const pts = pointsForVisit(o.settings.loyalty, amount);
        out.visits.push({
          id: visitId, customerId: id, occurredAt: at.toUTC().toISO()!, date, amount, items: between(1, kind === 'vip' ? 14 : 5), categories: cats,
          source: res ? 'reservation' : kind === 'shisha' ? 'counter' : 'pos', externalRef: res ? res.id : `OR-${between(100000, 999999)}`, reservationId: res?.id ?? null,
          serverEmployeeId: res ? res.hostEmployeeId : kind === 'shisha' ? pick(o.emp.shisha) : pick(o.emp.servers), pointsEarned: pts,
        });
        if (pts) out.points.push({ id: o.uid(), customerId: id, visitId, kind: 'earn', points: pts, rewardKey: null, note: null, createdAt: at.toUTC().toISO()!, date });
        count++;
        d = d.plus({ days: Math.max(1, Math.round(gap * (0.6 + rand() * 0.8))) });
      }
      if (o.settings.loyalty.welcomePoints) out.points.push({ id: o.uid(), customerId: id, visitId: null, kind: 'bonus', points: o.settings.loyalty.welcomePoints, rewardKey: null, note: 'Welcome points', createdAt: created.toUTC().toISO()!, date: created.toISODate()! });
    }
  }

  // Some guests already redeemed rewards.
  const bal = new Map<string, number>();
  for (const p of out.points) bal.set(p.customerId, (bal.get(p.customerId) ?? 0) + p.points);
  for (const [cid, b] of bal) {
    const r = [...o.settings.loyalty.rewards].sort((a, z) => z.points - a.points).find((x) => x.points <= b);
    if (r && rand() < 0.5) out.points.push({ id: o.uid(), customerId: cid, visitId: null, kind: 'redeem', points: -r.points, rewardKey: r.key, note: r.name, createdAt: today.minus({ days: between(3, 40) }).toUTC().toISO()!, date: today.minus({ days: between(3, 40) }).toISODate()! });
  }

  // Tonight's book: VIPs and a few club regulars, plus a pending request.
  const vips = out.customers.slice(0, 26);
  const tonight = o.today;
  for (const [i, c] of [...vips.slice(0, 7), ...out.customers.slice(30, 33)].entries()) {
    const area = i < 7 ? pick(['Regular VIP', 'Mega VIP', 'King VIP', 'Ultra VIP', 'Single Ultra VIP']) : pick(['Long table', 'Cocktail table']);
    out.reservations.push({ id: o.uid(), customerId: c.id, date: tonight, arrivalTime: `${between(21, 23)}:${pick(['00', '30'])}`, partySize: between(2, 10), tableArea: area, minSpend: tableMin(area),
      deposit: i < 3 ? Math.round(tableMin(area) * 0.3) : 0, status: i === 9 ? 'requested' : 'confirmed', hostEmployeeId: i < 7 ? pick(o.emp.hosts) : null, promoterEmployeeId: c.referredByEmployeeId,
      notes: i === 0 ? 'Birthday — prepare sparklers and cake' : i === 2 ? 'Wants the same table as last time' : null, actualSpend: null, createdAt: today.minus({ days: between(0, 3) }).toUTC().toISO()! });
  }

  // A past campaign with a holdout, so the results page shows measured lift.
  const sentAt = today.minus({ days: 21 }).set({ hour: 15 });
  const camp: CampaignRow = {
    id: o.uid(), name: 'Weekend comeback — club regulars', channel: 'sms', template: 'Hi {{firstName}}, this Saturday is on us: free entry for 2 + double points. Show this SMS at the door.',
    filter: { minDaysSinceLastVisit: 14 }, holdoutPct: 20, status: 'sent', sentAt: sentAt.toUTC().toISO()!, holdoutIds: [], attributionDays: 14, createdAt: sentAt.minus({ hours: 2 }).toUTC().toISO()!,
  };
  out.campaigns.push(camp);
  const sentOn = sentAt.toISODate()!;
  const lastBefore = new Map<string, string>();
  for (const v of out.visits) if (v.date <= sentOn && (lastBefore.get(v.customerId) ?? '') < v.date) lastBefore.set(v.customerId, v.date);
  const audience = out.customers.slice(26).filter((c) => c.consent.sms?.granted && lastBefore.has(c.id) && DateTime.fromISO(lastBefore.get(c.id)!, { zone: o.tz }) <= sentAt.startOf('day').minus({ days: 14 }));
  for (const c of audience) {
    if (inHoldout(c.id, camp.id, camp.holdoutPct)) { camp.holdoutIds.push(c.id); continue; }
    const body = finalizeMessage(renderTemplate(camp.template, { firstName: c.firstName, business: o.business }), 'marketing', 'sms', o.business);
    const parts = smsParts(body).parts;
    out.messages.push({ id: o.uid(), customerId: c.id, campaignId: camp.id, automationKey: null, channel: 'sms', purpose: 'marketing', to: c.phone!, body, status: 'simulated', provider: 'log', providerRef: null, error: null, parts, cost: Math.round(parts * o.settings.costPerSms * 100) / 100, createdAt: sentAt.toUTC().toISO()! });
    // Sample response: about a third of messaged guests came that weekend (the holdout keeps its normal rhythm).
    if (rand() < 0.45) {
      const date = sentAt.plus({ days: between(1, 5) }).toISODate()!;
      const amount = Math.round((1500 + rand() * 5000) / 50) * 50;
      const visitId = o.uid();
      out.visits.push({ id: visitId, customerId: c.id, occurredAt: atNight(date, 22, 23).toUTC().toISO()!, date, amount, items: between(1, 5), categories: ['beer', 'cocktails'], source: 'pos', externalRef: `OR-${between(100000, 999999)}`, reservationId: null, serverEmployeeId: pick(o.emp.servers), pointsEarned: pointsForVisit(o.settings.loyalty, amount), note: 'Comeback promo' });
    }
  }

  // Welcome automation history for recent first-timers.
  for (const c of out.customers) {
    const first = out.visits.filter((v) => v.customerId === c.id).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!first || !c.consent.sms?.granted || first.date > o.today) continue;
    const at = DateTime.fromISO(first.date, { zone: o.tz }).plus({ days: 1, hours: 13 });
    if (at > DateTime.now().setZone(o.tz)) continue;
    const body = finalizeMessage(renderTemplate('Hi {{firstName}}, thanks for partying with us! You have {{points}} points. Show this number at the bar next time to earn more.', { firstName: c.firstName, business: o.business, points: first.pointsEarned + o.settings.loyalty.welcomePoints }), 'marketing', 'sms', o.business);
    out.messages.push({ id: o.uid(), customerId: c.id, campaignId: null, automationKey: 'welcome', channel: 'sms', purpose: 'marketing', to: c.phone!, body, status: 'simulated', provider: 'log', providerRef: null, error: null, parts: smsParts(body).parts, cost: Math.round(smsParts(body).parts * o.settings.costPerSms * 100) / 100, createdAt: at.toUTC().toISO()! });
  }
  return out;
}
