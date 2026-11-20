import { round2 } from '../lib/money.js';
import type { ResolvedRole } from '../policy/jobs.js';

/**
 * The company's 7-Step Management System. Heads of department and supervisors review each
 * specialist with these steps, place them in one of 5 categories and set tomorrow's action plan.
 * Steps 1 (quantity) and 3 (hours) measure effort; steps 2 (quality), 4 (operational) and
 * 5 (financial) measure results. Results × effort gives the suggested category.
 */

export const SCALE = ['excellent', 'good', 'bad', 'terrible'] as const;
export type Score = typeof SCALE[number];
export const SCORE_LABEL: Record<Score, string> = { excellent: 'Excellent', good: 'Good', bad: 'Bad', terrible: 'Terrible' };
const POINTS: Record<Score, number> = { excellent: 4, good: 3, bad: 2, terrible: 1 };

export const STEPS = [
  { n: 1, key: 'quantity', title: 'Quantity Check', text: 'Compare assigned tasks vs completed tasks. Score: Excellent / Good / Bad / Terrible.', measures: 'effort' },
  { n: 2, key: 'quality', title: 'Quality of Work', text: 'Were completed tasks done well? Separate from quantity. Score same scale.', measures: 'results' },
  { n: 3, key: 'hours', title: 'Hours Worked', text: 'Scheduled hours vs actual productive hours. Note discrepancies.', measures: 'effort' },
  { n: 4, key: 'operational', title: 'Operational Results', text: 'Non-financial outcomes: table turn time, order accuracy, waste %, upsell rate. Always compare Plan vs Fact.', measures: 'results' },
  { n: 5, key: 'financial', title: 'Financial Results', text: 'Revenue generated, cost to the company. Compare Plan vs Fact.', measures: 'results' },
  { n: 6, key: 'category', title: 'Category (1-5)', text: 'Based on steps 1-5, categorize the specialist.', measures: null },
  { n: 7, key: 'action', title: 'Action Plan', text: 'Specific, actionable plan for the specialist tomorrow. Result > Analysis > Action.', measures: null },
] as const;

export const CATEGORIES = [
  { n: 1, title: 'Good Results + Hard Working', tag: 'A-Players', action: 'Protect and retain.', results: true, hard: true },
  { n: 2, title: 'Good Results + Lazy', tag: 'Talented but coasting', action: 'Let them bring you profit.', results: true, hard: false },
  { n: 3, title: 'Poor Results + Hard Working + Learning', tag: 'New or inexperienced, great attitude', action: 'Invest in training.', results: false, hard: true },
  { n: 4, title: 'Poor Results + Hard Working + Cannot Improve', tag: 'Trying hard but not improving despite coaching', action: 'Let them go.', results: false, hard: true },
  { n: 5, title: 'Poor Results + Lazy', tag: 'Poor results and no effort', action: 'Fire immediately.', results: false, hard: false },
] as const;

export interface Metric { name: string; unit?: string; plan: number | null; fact: number | null; lowerIsBetter?: boolean }
export interface ReviewInput {
  tasksAssigned: number | null;
  tasksCompleted: number | null;
  quantityScore: Score | null;
  qualityScore: Score | null;
  qualityNote?: string | null;
  scheduledHours: number | null;
  productiveHours: number | null;
  hoursNote?: string | null;
  operational: Metric[];
  revenuePlan: number | null;
  revenueFact: number | null;
  cost: number | null;
  /** Reviewer's call on effort and progress; when left empty the analysis suggests one. */
  effort?: 'hard' | 'lazy' | null;
  improving?: boolean | null;
}

/** Fact ÷ plan (plan ÷ fact when lower is better); null when either is missing. */
export function achievement(m: Pick<Metric, 'plan' | 'fact' | 'lowerIsBetter'>) {
  if (m.plan === null || m.fact === null || m.plan < 0 || m.fact < 0) return null;
  if (m.lowerIsBetter) return m.fact === 0 ? (m.plan === 0 ? 1 : 2) : m.plan / m.fact;
  return m.plan === 0 ? (m.fact > 0 ? 2 : 1) : m.fact / m.plan;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);

/** A suggested score from tasks assigned vs completed (step 1). */
export function scoreFromCompletion(assigned: number | null, completed: number | null): Score | null {
  if (!assigned || completed === null) return null;
  const r = completed / assigned;
  return r >= 1 ? 'excellent' : r >= 0.85 ? 'good' : r >= 0.6 ? 'bad' : 'terrible';
}

/**
 * Steps 1–5 → category (step 6). `history` is the specialist's earlier reviews (newest first)
 * and decides "learning" vs "cannot improve" for hard workers with poor results.
 */
export function analyse(input: ReviewInput, history: { date: string; category: number; resultsIndex: number | null }[] = []) {
  const completion = input.tasksAssigned ? (input.tasksCompleted ?? 0) / input.tasksAssigned : null;
  const quantity = input.quantityScore ?? scoreFromCompletion(input.tasksAssigned, input.tasksCompleted);
  const hoursRatio = input.scheduledHours ? (input.productiveHours ?? 0) / input.scheduledHours : null;
  const ops = input.operational.map((m) => ({ ...m, achievement: achievement(m) }));
  const opsAch = mean(ops.map((m) => m.achievement).filter((x): x is number => x !== null).map((x) => Math.min(x, 1.5)));
  const revAch = achievement({ plan: input.revenuePlan, fact: input.revenueFact });
  const margin = input.revenueFact !== null && input.cost !== null ? round2(input.revenueFact - input.cost) : null;

  // Results: quality (2), operational (4), financial (5). Effort: quantity (1), hours (3).
  const resultParts = [input.qualityScore ? POINTS[input.qualityScore] / 4 : null, opsAch === null ? null : Math.min(opsAch, 1), revAch === null ? null : Math.min(revAch, 1)].filter((x): x is number => x !== null);
  const resultsIndex = resultParts.length ? Math.round(mean(resultParts)! * 1000) / 1000 : null;
  const resultsGood = (input.qualityScore ? POINTS[input.qualityScore] >= 3 : true) && (opsAch ?? 1) >= 0.9 && (revAch ?? 1) >= 0.9 && resultParts.length > 0;
  const effortParts = [quantity ? POINTS[quantity] >= 3 : null, hoursRatio === null ? null : hoursRatio >= 0.9].filter((x): x is boolean => x !== null);
  const suggestedEffort: 'hard' | 'lazy' | null = effortParts.length ? (effortParts.every(Boolean) ? 'hard' : 'lazy') : null;
  const effort = input.effort ?? suggestedEffort;

  // Learning vs cannot improve: 3+ earlier poor-result reviews in a row with no upward trend.
  const poorRun = [];
  for (const h of history) { if (h.category >= 3) poorRun.push(h); else break; }
  const firstIdx = poorRun.length ? poorRun[poorRun.length - 1].resultsIndex : null;
  const stuck = poorRun.length >= 3 && (resultsIndex === null || firstIdx === null || resultsIndex <= firstIdx + 0.05);
  const suggestedImproving = !stuck;
  const improving = input.improving ?? suggestedImproving;

  const reasons: string[] = [];
  if (completion !== null) reasons.push(`Completed ${input.tasksCompleted ?? 0} of ${input.tasksAssigned} tasks (${pct(completion)}%).`);
  if (hoursRatio !== null) reasons.push(`Productive ${input.productiveHours ?? 0} h of ${input.scheduledHours} h scheduled (${pct(hoursRatio)}%).`);
  for (const m of ops) if (m.achievement !== null) reasons.push(`${m.name}: fact ${m.fact}${m.unit ?? ''} vs plan ${m.plan}${m.unit ?? ''} (${pct(m.achievement)}%).`);
  if (revAch !== null) reasons.push(`Revenue ₱${input.revenueFact?.toLocaleString('en-PH')} vs plan ₱${input.revenuePlan?.toLocaleString('en-PH')} (${pct(revAch)}%).`);
  if (stuck) reasons.push(`${poorRun.length} reviews in a row with poor results and no improvement.`);

  let suggestedCategory: number | null = null;
  if (resultParts.length && effort) {
    suggestedCategory = resultsGood ? (effort === 'hard' ? 1 : 2) : effort === 'lazy' ? 5 : improving ? 3 : 4;
  }
  return {
    completion: pct(completion), quantity, hoursRatio: pct(hoursRatio), hoursGap: input.scheduledHours !== null && input.productiveHours !== null ? round2(input.productiveHours - input.scheduledHours) : null,
    operational: ops.map((m) => ({ ...m, achievement: pct(m.achievement) })), operationalAchievement: pct(opsAch),
    revenueAchievement: pct(revAch), margin, resultsIndex, resultsGood, suggestedEffort, effort, suggestedImproving, improving, suggestedCategory, reasons,
  };
}
export type Analysis = ReturnType<typeof analyse>;

/** Plan-vs-fact metrics a head starts from, per department (step 4). Tracker metrics are filled in automatically. */
export const OPERATIONAL_TEMPLATES: Record<string, Metric[]> = {
  Servers: [{ name: 'Orders', plan: null, fact: null }, { name: "LD's", plan: null, fact: null }, { name: 'Sales comms. (packages)', plan: null, fact: null }, { name: 'Order accuracy', unit: '%', plan: 98, fact: null }],
  Bartenders: [{ name: 'Drink ticket time', unit: ' min', plan: 5, fact: null, lowerIsBetter: true }, { name: 'Order accuracy', unit: '%', plan: 98, fact: null }, { name: 'Waste', unit: '%', plan: 2, fact: null, lowerIsBetter: true }, { name: 'Upsell rate', unit: '%', plan: 20, fact: null }],
  Kitchen: [{ name: 'Ticket time', unit: ' min', plan: 15, fact: null, lowerIsBetter: true }, { name: 'Order accuracy', unit: '%', plan: 98, fact: null }, { name: 'Waste', unit: '%', plan: 3, fact: null, lowerIsBetter: true }],
  Cashiers: [{ name: 'Cash variance', unit: ' ₱', plan: 0, fact: null, lowerIsBetter: true }, { name: 'Payment errors', plan: 0, fact: null, lowerIsBetter: true }],
  Bouncers: [{ name: 'Incidents handled', plan: null, fact: null }, { name: 'Post coverage', unit: '%', plan: 100, fact: null }],
  Promoters: [{ name: 'Guests on guestlist', plan: 10, fact: null }, { name: 'Table reservations', plan: 2, fact: null }],
  Housekeeping: [{ name: 'Area checklists done', unit: '%', plan: 100, fact: null }, { name: 'Complaints about cleanliness', plan: 0, fact: null, lowerIsBetter: true }],
  default: [{ name: 'Table turn time', unit: ' min', plan: null, fact: null, lowerIsBetter: true }, { name: 'Order accuracy', unit: '%', plan: 98, fact: null }, { name: 'Waste', unit: '%', plan: 2, fact: null, lowerIsBetter: true }, { name: 'Upsell rate', unit: '%', plan: 20, fact: null }],
};

/** Templates with the Servers tracker filled in: plan = the person's average per worked night over the 28 days before. */
export function operationalFor(department: string | null, tracker?: { today: { orders: number; lds: number; salesComms: number } | null; history: { orders: number; lds: number; salesComms: number }[] }) {
  const base = (OPERATIONAL_TEMPLATES[department ?? ''] ?? OPERATIONAL_TEMPLATES.default).map((m) => ({ ...m }));
  if (department === 'Servers' && tracker) {
    const avg = (k: 'orders' | 'lds' | 'salesComms') => (tracker.history.length ? Math.round(tracker.history.reduce((a, x) => a + x[k], 0) / tracker.history.length) : null);
    const map: Record<string, 'orders' | 'lds' | 'salesComms'> = { Orders: 'orders', "LD's": 'lds', 'Sales comms. (packages)': 'salesComms' };
    for (const m of base) { const k = map[m.name]; if (k) { m.plan = avg(k); m.fact = tracker.today ? tracker.today[k] : null; } }
  }
  return base;
}

/** Hours a person is scheduled on a working day: shift length less the 1-hour break. */
export function scheduledHoursFor(shiftStart?: string, shiftEnd?: string) {
  if (!shiftStart || !shiftEnd) return 8;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let len = m(shiftEnd) - m(shiftStart);
  if (len <= 0) len += 1440;
  return Math.max(0, round2(len / 60 - 1));
}

/** Shared by the server and the demo: coverage and categories for the control view. */
export function mgmtOverview(x: {
  emps: { id: string; name: string; department: string | null }[];
  reviews: { employeeId: string; date: string; category: number; reviewerName: string; reviewerRoleKey: string | null; action: string }[];
  roles: ResolvedRole[]; from: string; to: string;
}) {
  const latest = new Map<string, (typeof x.reviews)[number]>();
  for (const r of [...x.reviews].sort((a, b) => a.date.localeCompare(b.date))) latest.set(r.employeeId, r);
  const inRange = x.reviews.filter((r) => r.date >= x.from && r.date <= x.to);
  const reviewedIds = new Set(inRange.map((r) => r.employeeId));
  const departments = [...new Set(x.emps.map((e) => e.department ?? 'Unassigned'))].map((d) => {
    const team = x.emps.filter((e) => (e.department ?? 'Unassigned') === d);
    const staffRole = x.roles.find((r) => r.key === `staff:${d}`);
    const head = staffRole?.reportsTo ? x.roles.find((r) => r.key === staffRole.reportsTo) : undefined;
    const cats = [0, 0, 0, 0, 0];
    for (const e of team) { const l = latest.get(e.id); if (l) cats[l.category - 1]++; }
    return { department: d, head: head ? { key: head.key, title: head.title, holder: head.holder, no: head.no } : null, team: team.length, reviewed: team.filter((e) => reviewedIds.has(e.id)).length, categories: cats, reviewsInRange: inRange.filter((r) => team.some((e) => e.id === r.employeeId)).length };
  }).sort((a, b) => (a.head?.no ?? 99) - (b.head?.no ?? 99) || a.department.localeCompare(b.department));
  const totals = [0, 0, 0, 0, 0];
  for (const l of latest.values()) totals[l.category - 1]++;
  const byName = new Map(x.emps.map((e) => [e.id, e]));
  const alerts = [...latest.values()].filter((l) => l.category >= 4 && byName.has(l.employeeId)).map((l) => ({ employeeId: l.employeeId, name: byName.get(l.employeeId)!.name, department: byName.get(l.employeeId)!.department, category: l.category, date: l.date, action: l.action }));
  const reviewers = [...new Set(inRange.map((r) => r.reviewerName))].map((n) => ({ name: n, reviews: inRange.filter((r) => r.reviewerName === n).length, people: new Set(inRange.filter((r) => r.reviewerName === n).map((r) => r.employeeId)).size }))
    .sort((a, b) => b.reviews - a.reviews);
  return { from: x.from, to: x.to, totals, reviewed: reviewedIds.size, people: x.emps.length, reviews: inRange.length, departments, alerts, reviewers };
}
