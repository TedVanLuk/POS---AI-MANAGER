/**
 * AI Marketing — CRM engine. Pure functions only (no DB, no clock), shared by the API and the
 * in-browser demo, like the payroll engine.
 *
 *  · Guest intelligence (SevenRooms-style): lifetime/rolling spend, visit rhythm, rules-based auto-tags, VIP tiers.
 *  · Loyalty (Square-style): phone-number enrolment, one earn rule, rewards, FIFO point expiry.
 *  · Marketing (GoHighLevel-style): segments, audiences, consent-aware sends, automations, playbooks.
 *  · Measurement: RFM segments, cohort retention and campaign lift against a holdout group.
 */

export type Channel = 'sms' | 'viber' | 'email' | 'messenger';
export const CHANNELS: Channel[] = ['sms', 'viber', 'email', 'messenger'];
export type Purpose = 'marketing' | 'transactional';

export interface LoyaltyReward { key: string; name: string; points: number; kind: 'amount_off' | 'percent_off' | 'free_item'; value: number; item?: string }
export interface LoyaltyProgram {
  enabled: boolean;
  name: string;
  /** Square-style single earn rule: points per ₱ spent, or a fixed number of points per qualifying visit. */
  earn: { kind: 'spend'; pesosPerPoint: number } | { kind: 'visit'; points: number; minSpend: number };
  rewards: LoyaltyReward[];
  welcomePoints: number;
  birthdayPoints: number;
  /** Points expire this many days after they were earned (FIFO). Null = never. */
  expiryDays: number | null;
}
export interface Tier { name: string; minSpend365: number; multiplier: number; perks: string }
export type TagField =
  | 'visits' | 'visits90' | 'spend' | 'spend365' | 'avgSpend' | 'maxSpend' | 'daysSinceLastVisit' | 'daysSinceFirstVisit'
  | 'bookings' | 'noShows' | 'daysToBirthday' | 'pointsBalance' | `cat:${string}`;
export interface TagCondition { field: TagField; op: 'gte' | 'lte' | 'eq'; value: number }
export interface TagRule { tag: string; description: string; when: TagCondition[] }

export type BusinessType = 'nightclub' | 'bar' | 'cafe' | 'shisha' | 'restaurant' | 'retail';
export interface CrmSettings {
  businessType: BusinessType;
  playbook: string | null;
  /** NTC-registered SMS sender name (max 11 chars). */
  senderName: string;
  loyalty: LoyaltyProgram;
  tiers: Tier[];
  tagRules: TagRule[];
  /** Spend categories staff can tick at the counter / POS sends (e.g. bottle, shisha, coffee). */
  categories: string[];
  /** Consent wording shown at enrolment; the version is stored with every consent event (proof under the DPA). */
  consentText: string;
  consentVersion: string;
  /** No marketing sends between these local hours (inclusive start, exclusive end). */
  quietHours: { start: number; end: number };
  /** % of each campaign audience held back to measure true lift. */
  holdoutPct: number;
  /** A visit within this many days after a message counts as a conversion. */
  attributionDays: number;
  /** Business day starts at this local hour (a 2 AM nightclub bill belongs to the previous night). */
  dayStartHour: number;
  /** Estimated cost per message part, ₱ (Semaphore list price ≈ ₱0.50–0.56 + VAT). */
  costPerSms: number;
  /** Profiles with no visit for this many days are flagged for deletion review (DPA retention). */
  retentionDays: number;
}

// ---------------------------------------------------------------- dates
const DAY = 86_400_000;
const dnum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const daysBetween = (fromIso: string, toIso: string) => Math.round((dnum(toIso) - dnum(fromIso)) / DAY);
export const addDays = (iso: string, n: number) => new Date(dnum(iso) + n * DAY).toISOString().slice(0, 10);

/** Days until the next birthday ("MM-DD"), 0 = today. Feb 29 is celebrated on Feb 28 in non-leap years. */
export function daysToBirthday(birthday: string | null | undefined, today: string): number | null {
  if (!birthday || !/^\d{2}-\d{2}$/.test(birthday)) return null;
  const y = +today.slice(0, 4);
  const at = (year: number) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const md = birthday === '02-29' && !leap ? '02-28' : birthday;
    return `${year}-${md}`;
  };
  const d = daysBetween(today, at(y));
  return d >= 0 ? d : daysBetween(today, at(y + 1));
}

// ---------------------------------------------------------------- guest stats
export interface VisitLike { customerId: string; date: string; amount: number; categories?: string[]; items?: number }
export interface CustomerStats {
  visits: number; visits90: number; visits365: number; spend: number; spend365: number; avgSpend: number; maxSpend: number;
  firstVisit: string | null; lastVisit: string | null; daysSinceLastVisit: number | null; daysSinceFirstVisit: number | null;
  /** Typical days between visits (median gap), null with fewer than 3 visits. */
  avgGapDays: number | null;
  /** Regular who has stayed away twice as long as usual — the moment to win them back. */
  overdue: boolean;
  categories: Record<string, number>;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function customerStats(visits: VisitLike[], today: string): CustomerStats {
  const v = [...visits].filter((x) => x.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const days = [...new Set(v.map((x) => x.date))];
  const spend = v.reduce((a, x) => a + x.amount, 0);
  const in365 = v.filter((x) => daysBetween(x.date, today) < 365);
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  const avgGapDays = days.length >= 3 ? median(gaps) : null;
  const last = days.at(-1) ?? null;
  const since = last ? daysBetween(last, today) : null;
  const categories: Record<string, number> = {};
  for (const x of v) for (const c of x.categories ?? []) categories[c] = (categories[c] ?? 0) + 1;
  return {
    visits: days.length,
    visits90: new Set(v.filter((x) => daysBetween(x.date, today) < 90).map((x) => x.date)).size,
    visits365: new Set(in365.map((x) => x.date)).size,
    spend: r2(spend), spend365: r2(in365.reduce((a, x) => a + x.amount, 0)),
    avgSpend: days.length ? r2(spend / days.length) : 0, maxSpend: v.reduce((a, x) => Math.max(a, x.amount), 0),
    firstVisit: days[0] ?? null, lastVisit: last, daysSinceLastVisit: since, daysSinceFirstVisit: days[0] ? daysBetween(days[0], today) : null,
    avgGapDays, overdue: avgGapDays !== null && since !== null && since > Math.max(14, avgGapDays * 2),
    categories,
  };
}

// ---------------------------------------------------------------- tiers, tags, RFM
export function tierFor(tiers: Tier[], spend365: number): Tier | null {
  return [...tiers].sort((a, b) => b.minSpend365 - a.minSpend365).find((t) => spend365 >= t.minSpend365) ?? null;
}

export function nextTier(tiers: Tier[], spend365: number): { tier: Tier; remaining: number } | null {
  const t = [...tiers].sort((a, b) => a.minSpend365 - b.minSpend365).find((x) => x.minSpend365 > spend365);
  return t ? { tier: t, remaining: r2(t.minSpend365 - spend365) } : null;
}

export interface TagContext { stats: CustomerStats; bookings?: number; noShows?: number; birthday?: string | null; pointsBalance?: number; today: string }
function fieldValue(f: TagField, c: TagContext): number | null {
  const s = c.stats;
  if (f.startsWith('cat:')) { const cat = f.slice(4); return s.visits ? (s.categories[cat] ?? 0) / s.visits * 100 : null; }
  switch (f) {
    case 'visits': return s.visits;
    case 'visits90': return s.visits90;
    case 'spend': return s.spend;
    case 'spend365': return s.spend365;
    case 'avgSpend': return s.visits ? s.avgSpend : null;
    case 'maxSpend': return s.visits ? s.maxSpend : null;
    case 'daysSinceLastVisit': return s.daysSinceLastVisit;
    case 'daysSinceFirstVisit': return s.daysSinceFirstVisit;
    case 'bookings': return c.bookings ?? 0;
    case 'noShows': return c.noShows ?? 0;
    case 'daysToBirthday': return daysToBirthday(c.birthday, c.today);
    case 'pointsBalance': return c.pointsBalance ?? 0;
    default: return null;
  }
}

/** Rules-based auto-tags. "cat:shisha ≥ 50" means at least half of the visits included shisha. */
export function autoTags(rules: TagRule[], c: TagContext): string[] {
  return rules.filter((r) => r.when.length && r.when.every((w) => {
    const v = fieldValue(w.field, c);
    if (v === null) return false;
    return w.op === 'gte' ? v >= w.value : w.op === 'lte' ? v <= w.value : v === w.value;
  })).map((r) => r.tag);
}

export type Segment = 'champion' | 'loyal' | 'cant_lose' | 'at_risk' | 'new' | 'promising' | 'need_attention' | 'hibernating' | 'lost' | 'no_visits';
export const SEGMENTS: Record<Segment, { label: string; advice: string }> = {
  champion: { label: 'Champions', advice: 'Recent, frequent, high spend. Recognise them by name, give early access, ask for referrals.' },
  loyal: { label: 'Loyal regulars', advice: 'Come often. Keep them with tier perks and surprise rewards, not discounts.' },
  cant_lose: { label: "Can't lose", advice: 'Big spenders who stopped coming. Personal call or message from the manager / VIP host.' },
  at_risk: { label: 'At risk', advice: 'Used to come often, now slipping. Win-back offer with a deadline.' },
  new: { label: 'New guests', advice: 'First visit recently. Thank-you message and a reason to come back within 2 weeks.' },
  promising: { label: 'Promising', advice: 'Recent but not yet regular. Push the 2nd and 3rd visit (bonus points).' },
  need_attention: { label: 'Need attention', advice: 'Average guests cooling down. Event invite or limited-time offer.' },
  hibernating: { label: 'Hibernating', advice: 'Few visits, long ago. Include in big seasonal campaigns only.' },
  lost: { label: 'Lost', advice: 'Gone for months. Low priority; review for data retention.' },
  no_visits: { label: 'No visits yet', advice: 'Enrolled (e.g. guestlist or import) but never bought. Invite to a first visit.' },
};

/** Fixed thresholds instead of quantiles, so small venues get stable segments. Monetary is relative to the venue's median guest. */
export function rfm(s: CustomerStats, medianSpend365: number): { r: number; f: number; m: number; segment: Segment } {
  if (!s.visits || s.daysSinceLastVisit === null) return { r: 0, f: 0, m: 0, segment: 'no_visits' };
  const d = s.daysSinceLastVisit;
  const r = d <= 14 ? 5 : d <= 30 ? 4 : d <= 60 ? 3 : d <= 120 ? 2 : 1;
  const n = s.visits365;
  const f = n >= 12 ? 5 : n >= 6 ? 4 : n >= 3 ? 3 : n === 2 ? 2 : 1;
  const ratio = medianSpend365 > 0 ? s.spend365 / medianSpend365 : 1;
  const m = ratio >= 3 ? 5 : ratio >= 1.5 ? 4 : ratio >= 0.75 ? 3 : ratio >= 0.35 ? 2 : 1;
  let segment: Segment;
  if (r >= 4 && f >= 4 && m >= 4) segment = 'champion';
  else if (r >= 3 && f >= 4) segment = 'loyal';
  else if (r <= 2 && f >= 4 && m >= 4) segment = 'cant_lose';
  else if (r <= 2 && f >= 3) segment = 'at_risk';
  else if (r >= 4 && s.visits === 1) segment = 'new';
  else if (r >= 4) segment = 'promising';
  else if (r === 3) segment = 'need_attention';
  else if (r === 2) segment = 'hibernating';
  else segment = 'lost';
  return { r, f, m, segment };
}

// ---------------------------------------------------------------- loyalty
export interface LedgerEntry { date: string; points: number; kind: 'earn' | 'bonus' | 'redeem' | 'adjust' | 'expire' }

export function pointsForVisit(p: LoyaltyProgram, amount: number, multiplier = 1): number {
  if (!p.enabled || amount <= 0) return 0;
  const base = p.earn.kind === 'spend' ? Math.floor(amount / Math.max(1, p.earn.pesosPerPoint)) : amount >= p.earn.minSpend ? p.earn.points : 0;
  return Math.floor(base * (multiplier || 1));
}

export const balanceOf = (ledger: LedgerEntry[]) => ledger.reduce((a, e) => a + e.points, 0);

/**
 * Points that have passed their expiry date and are still unspent (oldest points are spent first).
 * The caller writes one 'expire' entry for this amount.
 */
export function expiringPoints(ledger: LedgerEntry[], today: string, expiryDays: number | null): number {
  if (!expiryDays) return 0;
  const credits = ledger.filter((e) => e.points > 0).sort((a, b) => a.date.localeCompare(b.date));
  let debits = -ledger.filter((e) => e.points < 0).reduce((a, e) => a + e.points, 0);
  let expired = 0;
  for (const c of credits) {
    const use = Math.min(debits, c.points);
    debits -= use;
    const left = c.points - use;
    if (left > 0 && daysBetween(c.date, today) >= expiryDays) expired += left;
  }
  return expired;
}

export const rewardsAvailable = (p: LoyaltyProgram, balance: number) => p.rewards.filter((r) => r.points <= balance).sort((a, b) => b.points - a.points);
export function nextReward(p: LoyaltyProgram, balance: number): { reward: LoyaltyReward; remaining: number } | null {
  const r = [...p.rewards].sort((a, b) => a.points - b.points).find((x) => x.points > balance);
  return r ? { reward: r, remaining: r.points - balance } : null;
}

// ---------------------------------------------------------------- consent & messaging
export interface ConsentRecord { granted: boolean; at: string; source: string; version?: string | null }
export type ConsentState = Partial<Record<Channel, ConsentRecord>>;

/**
 * Data Privacy Act: marketing needs a recorded opt-in (NPC Circular 2023-04 rejects silence, pre-ticked boxes
 * and "soft opt-in"). Transactional messages the guest asked for (booking confirmation, points balance) only
 * need a usable number. Erased profiles never receive anything.
 */
export function canMessage(c: { consent: ConsentState; phone: string | null; email?: string | null; erasedAt?: string | null }, channel: Channel, purpose: Purpose): { ok: boolean; reason?: string } {
  if (c.erasedAt) return { ok: false, reason: 'Profile erased' };
  const addr = channel === 'email' ? c.email : c.phone;
  if (!addr) return { ok: false, reason: channel === 'email' ? 'No email' : 'No mobile number' };
  // A STOP reply withdraws marketing consent; the guest still gets the booking confirmation they asked for.
  if (purpose === 'transactional') return { ok: true };
  const k = c.consent[channel];
  if (!k) return { ok: false, reason: 'No marketing consent' };
  if (!k.granted) return { ok: false, reason: 'Opted out' };
  return { ok: true };
}

/** STOP / UNSUBSCRIBE plus the Filipino words people actually reply with. */
export const isOptOutReply = (text: string) => /^\s*(stop|unsubscribe|unsub|cancel|end|quit|hinto|ayoko na|itigil|tigil|remove)\b/i.test(text);

export function inQuietHours(hour: number, q: { start: number; end: number }) {
  return q.start > q.end ? hour >= q.start || hour < q.end : hour >= q.start && hour < q.end;
}

export interface TemplateVars { firstName: string; business: string; points?: number; tier?: string | null; reward?: string | null; date?: string; [k: string]: string | number | null | undefined }
export function renderTemplate(tpl: string, vars: TemplateVars) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => { const v = vars[k]; return v === null || v === undefined ? '' : String(v); }).replace(/[ \t]{2,}/g, ' ').trim();
}

/** Marketing SMS must identify the sender and say how to stop (DPA transparency + telco rules). */
export function finalizeMessage(body: string, purpose: Purpose, channel: Channel, business: string) {
  if (purpose !== 'marketing') return body;
  let out = body;
  if (!out.toLowerCase().includes(business.toLowerCase())) out = `${business}: ${out}`;
  if (channel === 'sms' && !/stop/i.test(out)) out = `${out} Reply STOP to opt out.`;
  return out;
}

const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
/** SMS parts: 160/153 chars in GSM-7, 70/67 in Unicode (an emoji or "₱" turns the whole message Unicode). */
export function smsParts(text: string): { encoding: 'GSM-7' | 'UCS-2'; length: number; parts: number } {
  const gsm = [...text].every((ch) => GSM.includes(ch) || GSM_EXT.includes(ch));
  if (gsm) {
    const len = [...text].reduce((a, ch) => a + (GSM_EXT.includes(ch) ? 2 : 1), 0);
    return { encoding: 'GSM-7', length: len, parts: len <= 160 ? 1 : Math.ceil(len / 153) };
  }
  const len = [...text].reduce((a, ch) => a + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return { encoding: 'UCS-2', length: len, parts: len <= 70 ? 1 : Math.ceil(len / 67) };
}

// ---------------------------------------------------------------- audiences
export interface AudienceFilter {
  segments?: Segment[]; tags?: string[]; tiers?: string[]; minVisits?: number; maxVisits?: number;
  minDaysSinceLastVisit?: number; maxDaysSinceLastVisit?: number; minSpend365?: number; birthdayWithinDays?: number; categories?: string[];
}
export interface ProfileLike {
  id: string; phone: string | null; email?: string | null; erasedAt?: string | null; consent: ConsentState; birthday?: string | null;
  stats: CustomerStats; segment: Segment; tier: string | null; tags: string[]; pointsBalance: number;
}

export function matchesFilter(p: ProfileLike, f: AudienceFilter, today: string) {
  const s = p.stats;
  if (f.segments?.length && !f.segments.includes(p.segment)) return false;
  if (f.tags?.length && !f.tags.some((t) => p.tags.includes(t))) return false;
  if (f.tiers?.length && !f.tiers.includes(p.tier ?? '')) return false;
  if (f.minVisits !== undefined && s.visits < f.minVisits) return false;
  if (f.maxVisits !== undefined && s.visits > f.maxVisits) return false;
  if (f.minDaysSinceLastVisit !== undefined && (s.daysSinceLastVisit === null || s.daysSinceLastVisit < f.minDaysSinceLastVisit)) return false;
  if (f.maxDaysSinceLastVisit !== undefined && (s.daysSinceLastVisit === null || s.daysSinceLastVisit > f.maxDaysSinceLastVisit)) return false;
  if (f.minSpend365 !== undefined && s.spend365 < f.minSpend365) return false;
  if (f.birthdayWithinDays !== undefined) { const d = daysToBirthday(p.birthday, today); if (d === null || d > f.birthdayWithinDays) return false; }
  if (f.categories?.length && !f.categories.some((c) => (s.categories[c] ?? 0) > 0)) return false;
  return true;
}

export function selectAudience<P extends ProfileLike>(profiles: P[], f: AudienceFilter, channel: Channel, purpose: Purpose, today: string) {
  const matched = profiles.filter((p) => !p.erasedAt && matchesFilter(p, f, today));
  const eligible: P[] = []; const excluded: { id: string; reason: string }[] = [];
  for (const p of matched) { const c = canMessage(p, channel, purpose); if (c.ok) eligible.push(p); else excluded.push({ id: p.id, reason: c.reason! }); }
  return { matched: matched.length, eligible, excluded };
}

/** Deterministic holdout: the same guest always lands in the same group for a given campaign. */
export function inHoldout(customerId: string, campaignId: string, pct: number) {
  if (pct <= 0) return false;
  let h = 2166136261;
  for (const ch of `${campaignId}:${customerId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10_000) / 100 < pct;
}

// ---------------------------------------------------------------- measurement
export interface GroupResult { customers: number; converted: number; rate: number; revenue: number; revenuePerCustomer: number }
export interface LiftResult {
  windowDays: number; sentOn: string; complete: boolean;
  treated: GroupResult; holdout: GroupResult;
  /** Percentage points: treated conversion rate − holdout conversion rate. */
  liftPts: number | null;
  /** Revenue the campaign caused: (treated ₱/customer − holdout ₱/customer) × treated customers. */
  incrementalRevenue: number | null;
  cost: number; roi: number | null;
  /** proven = one-sided 95% significance on return rate; likely = ~80%; unclear = positive but could be chance. */
  confidence: 'proven' | 'likely' | 'unclear' | 'none' | 'too_small';
  verdict: string;
}

export function campaignLift(o: { treatedIds: string[]; holdoutIds: string[]; sentOn: string; windowDays: number; visits: VisitLike[]; cost: number; today: string }): LiftResult {
  const end = addDays(o.sentOn, o.windowDays);
  const inWindow = o.visits.filter((v) => v.date > o.sentOn && v.date <= end);
  const group = (ids: string[]): GroupResult => {
    const set = new Set(ids);
    const vs = inWindow.filter((v) => set.has(v.customerId));
    const converted = new Set(vs.map((v) => v.customerId)).size;
    const revenue = r2(vs.reduce((a, v) => a + v.amount, 0));
    return { customers: ids.length, converted, rate: ids.length ? r2((converted / ids.length) * 100) : 0, revenue, revenuePerCustomer: ids.length ? r2(revenue / ids.length) : 0 };
  };
  const treated = group(o.treatedIds); const holdout = group(o.holdoutIds);
  const measurable = holdout.customers >= 5 && treated.customers >= 5;
  const liftPts = measurable ? r2(treated.rate - holdout.rate) : null;
  const incrementalRevenue = measurable ? r2((treated.revenuePerCustomer - holdout.revenuePerCustomer) * treated.customers) : null;
  const roi = incrementalRevenue !== null && o.cost > 0 ? r2(incrementalRevenue / o.cost) : null;
  const complete = o.today >= end;
  // One-sided two-proportion z-test on "came back": is the messaged group's return rate higher than chance would explain?
  const z = measurable ? zScore(treated.converted, treated.customers, holdout.converted, holdout.customers) : null;
  const confidence: LiftResult['confidence'] = !measurable ? 'too_small' : z! >= 1.645 ? 'proven' : z! >= 0.84 ? 'likely' : liftPts! > 0 ? 'unclear' : 'none';
  const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
  const rates = `${treated.rate}% of messaged guests came back vs ${holdout.rate}% of the holdout`;
  const verdict = confidence === 'too_small'
    ? `Too few guests to measure (${treated.customers} messaged, ${holdout.customers} held out). Use a bigger audience or a 10–20% holdout.`
    : confidence === 'proven'
      ? `${complete ? 'Proven' : 'Proven so far'}: ${rates} — about ${peso(Math.max(0, incrementalRevenue!))} in extra sales${roi && roi > 0 ? ` (${roi}× the message cost)` : ''}.`
      : confidence === 'likely'
        ? `Likely working: ${rates}. Not yet certain with groups this size — repeat it or use a bigger audience to confirm.`
        : confidence === 'unclear'
          ? `Unclear: ${rates}. The difference is small enough to be chance.`
          : `${complete ? 'No lift' : 'No lift yet'}: ${rates}. Try a different offer, audience or timing.`;
  return { windowDays: o.windowDays, sentOn: o.sentOn, complete, treated, holdout, liftPts, incrementalRevenue, cost: r2(o.cost), roi, confidence, verdict };
}

function zScore(c1: number, n1: number, c2: number, n2: number) {
  const p = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (c1 / n1 - c2 / n2) / se;
}

/** Monthly cohorts: of the guests whose first visit was in month M, how many came back within 30 / 60 / 90 days. */
export function cohortRetention(firstVisits: { customerId: string; first: string }[], visits: VisitLike[], today: string, months = 6) {
  const byCustomer = new Map<string, string[]>();
  for (const v of visits) { const a = byCustomer.get(v.customerId) ?? []; a.push(v.date); byCustomer.set(v.customerId, a); }
  const cohorts = new Map<string, string[]>();
  for (const f of firstVisits) { const m = f.first.slice(0, 7); const a = cohorts.get(m) ?? []; a.push(f.customerId); cohorts.set(m, a); }
  const keys = [...cohorts.keys()].sort().slice(-months);
  return keys.map((month) => {
    const ids = cohorts.get(month)!;
    const within = (n: number) => {
      const eligible = ids.filter((id) => daysBetween(firstVisits.find((x) => x.customerId === id)!.first, today) >= n);
      if (!eligible.length) return null;
      const back = eligible.filter((id) => { const first = firstVisits.find((x) => x.customerId === id)!.first; return (byCustomer.get(id) ?? []).some((d) => d > first && daysBetween(first, d) <= n); });
      return Math.round((back.length / eligible.length) * 100);
    };
    return { month, guests: ids.length, d30: within(30), d60: within(60), d90: within(90) };
  });
}

// ---------------------------------------------------------------- automations
export type AutomationTrigger = 'welcome' | 'birthday' | 'winback' | 'reward_ready' | 'post_visit' | 'vip_overdue';
export interface AutomationDef {
  key: string; name: string; trigger: AutomationTrigger; enabled: boolean; channel: Channel;
  /** welcome: days after 1st visit · birthday: days before · winback: days absent · post_visit: days after visit */
  days: number;
  filter: AudienceFilter; template: string;
  /** Bonus points granted with the message (birthday treat, win-back incentive). */
  bonusPoints?: number;
}
export const TRIGGERS: Record<AutomationTrigger, string> = {
  welcome: 'After the first visit', birthday: 'Before the birthday', winback: 'Guest has not come back', reward_ready: 'Enough points for a reward',
  post_visit: 'After each visit', vip_overdue: 'Regular is overdue (2× their usual gap)',
};

export interface SentLog { automationKey: string; customerId: string; date: string }

/**
 * Which guests an automation should message today. Each trigger fires once per "event": once per first visit,
 * once per birthday year, once per lapse (until the guest visits again), once per reward threshold crossing.
 */
export function dueAutomation(a: AutomationDef, profiles: ProfileLike[], sent: SentLog[], today: string, cheapestReward: number | null): ProfileLike[] {
  if (!a.enabled) return [];
  const lastSent = new Map<string, string>();
  for (const s of sent) if (s.automationKey === a.key && (lastSent.get(s.customerId) ?? '') < s.date) lastSent.set(s.customerId, s.date);
  return profiles.filter((p) => {
    if (p.erasedAt || !matchesFilter(p, a.filter, today)) return false;
    const s = p.stats; const prev = lastSent.get(p.id);
    switch (a.trigger) {
      case 'welcome': return s.visits === 1 && s.daysSinceFirstVisit === a.days && !prev;
      case 'post_visit': return s.daysSinceLastVisit === a.days && (!prev || prev < s.lastVisit!);
      case 'birthday': { const d = daysToBirthday(p.birthday, today); return d === a.days && (!prev || daysBetween(prev, today) > 300); }
      case 'winback': return s.visits >= 2 && s.daysSinceLastVisit !== null && s.daysSinceLastVisit >= a.days && (!prev || prev < s.lastVisit!);
      case 'vip_overdue': return s.overdue && (!prev || prev < s.lastVisit!);
      // Only right after a visit (≤ 2 days), so switching it on does not text the whole back catalogue.
      case 'reward_ready': return cheapestReward !== null && p.pointsBalance >= cheapestReward && s.daysSinceLastVisit !== null && s.daysSinceLastVisit <= Math.max(2, a.days) && (!prev || prev < s.lastVisit!);
    }
  });
}
