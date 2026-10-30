import type { AttendanceTotals } from '../attendance/engine.js';
import type { ReviewRatings } from '../db/schema.js';
import { median } from './engine.js';

/**
 * Pure performance model behind the Employee card and its summary page.
 * Efficiency calculator: Attendance 30% · Punctuality 20% · Sales 25% · Discipline 15% · Teamwork 10%.
 * Teamwork and competencies come from the latest management review (5-star scale).
 */

export const WEIGHTS = { attendance: 0.3, punctuality: 0.2, sales: 0.25, discipline: 0.15, teamwork: 0.1 } as const;
export const COMPETENCIES: { key: keyof ReviewRatings; label: string }[] = [
  { key: 'serviceQuality', label: 'Service quality' },
  { key: 'productKnowledge', label: 'Product knowledge' },
  { key: 'problemSolving', label: 'Problem solving' },
  { key: 'timeManagement', label: 'Time management' },
  { key: 'adaptability', label: 'Adaptability' },
  { key: 'workEthic', label: 'Work ethic' },
];
export const BEHAVIOUR: { key: keyof ReviewRatings; label: string }[] = [
  { key: 'leadership', label: 'Leadership' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'communication', label: 'Communication' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'customerOrientation', label: 'Customer orientation' },
];

export interface SalesTotals { orders: number; salesComms: number; lds: number; po: number; daysWithData: number }
export interface PerformanceInput {
  attendance: AttendanceTotals;
  leaveDays: number;
  approvedPenalties: number;
  penaltyAmount: number;
  warnings: number;
  compliments: number;
  sales: SalesTotals | null;
  /** Sales index of everyone in the team who has tracker data (for a fair, relative score). */
  teamSalesIndex: number[];
  ratings: ReviewRatings | null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Orders per working day plus weighted sales (packages count 5×, LDs 2×). */
export function salesIndex(s: SalesTotals | null, daysWorked: number) {
  if (!s || s.orders + s.salesComms + s.lds + s.po === 0) return null;
  const days = Math.max(1, daysWorked || s.daysWithData);
  return (s.orders + 2 * s.lds + 5 * s.salesComms + 3 * s.po) / days;
}

const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function performanceScores(i: PerformanceInput) {
  const a = i.attendance;
  const attendance = a.scheduledDays > 0 ? clamp((100 * Math.min(a.daysPresent, a.scheduledDays)) / a.scheduledDays - a.missingPunches * 2) : null;
  const punctuality = a.daysPresent > 0 ? clamp(100 - (a.lateCount / a.daysPresent) * 100 - Math.min(20, a.lateMinutes / a.daysPresent)) : null;
  const idx = salesIndex(i.sales, a.daysPresent);
  let sales: number | null = null;
  if (idx !== null) {
    // 70 at the team median; doubling the median adds 25 points, half the median takes 25 off.
    const med = median(i.teamSalesIndex);
    sales = med > 0 ? clamp(70 + 25 * Math.log2(Math.max(idx, 0.01) / med), 30, 100) : 70;
  } else if (i.ratings) {
    const r = avg([i.ratings.serviceQuality, i.ratings.productKnowledge, i.ratings.customerOrientation]);
    sales = r !== null ? r * 20 : null;
  }
  const discipline = clamp(100 - i.warnings * 10 - i.approvedPenalties * 4);
  const teamStars = i.ratings ? avg([i.ratings.teamwork, i.ratings.communication, i.ratings.reliability, i.ratings.professionalism, i.ratings.leadership]) : null;
  const teamwork = teamStars !== null ? teamStars * 20 : clamp(80 + i.compliments * 3 - i.warnings * 5);

  const parts = { attendance, punctuality, sales, discipline, teamwork };
  let wsum = 0, total = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const v = parts[k];
    if (v === null) continue;
    wsum += w;
    total += v * w;
  }
  const overall = wsum ? r1(total / wsum) : 0;
  return {
    components: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v === null ? null : r1(v)])) as Record<keyof typeof WEIGHTS, number | null>,
    overall,
    stars: Math.round((overall / 20) * 2) / 2,
    label: overall >= 90 ? 'Excellent performance' : overall >= 80 ? 'Very good performance' : overall >= 70 ? 'Good performance' : overall >= 60 ? 'Fair performance' : 'Needs improvement',
    tier: (overall >= 90 ? 'legend' : overall >= 80 ? 'gold' : overall >= 65 ? 'silver' : 'bronze') as 'legend' | 'gold' | 'silver' | 'bronze',
    salesIndex: idx,
  };
}

/** Card attributes (0–99) derived from the same scores, so the card and the summary always agree. */
export function cardAttributes(s: ReturnType<typeof performanceScores>, i: PerformanceInput, teamOrdersPerDay: number) {
  const c = s.components;
  const toCard = (v: number | null) => (v === null ? null : Math.max(1, Math.min(99, Math.round(v))));
  const opd = i.sales && i.attendance.daysPresent ? i.sales.orders / i.attendance.daysPresent : null;
  return {
    PUN: toCard(c.punctuality),
    ATT: toCard(c.attendance),
    SPD: null as number | null,
    HUS: opd === null || teamOrdersPerDay <= 0 ? null : toCard(70 * (opd / teamOrdersPerDay)),
    SAL: toCard(c.sales),
    DIS: toCard(c.discipline),
    REP: toCard(c.teamwork),
  };
}

export interface PersonInput extends Omit<PerformanceInput, 'teamSalesIndex'> { id: string; department: string }

/** Score everyone together: relative sales, card attributes and rank inside each department. */
export function evaluateTeam(people: PersonInput[]) {
  const teamSalesIndex = people.map((p) => salesIndex(p.sales, p.attendance.daysPresent)).filter((x): x is number => x !== null);
  const teamOrdersPerDay = median(people.map((p) => (p.sales && p.attendance.daysPresent ? p.sales.orders / p.attendance.daysPresent : 0)));
  const scored = people.map((p) => {
    const scores = performanceScores({ ...p, teamSalesIndex });
    return { id: p.id, department: p.department, input: p, scores, attributes: cardAttributes(scores, { ...p, teamSalesIndex }, teamOrdersPerDay), rank: { position: 0, of: 0 } };
  });
  const byDept = new Map<string, typeof scored>();
  for (const s of scored) byDept.set(s.department, [...(byDept.get(s.department) ?? []), s]);
  for (const list of byDept.values()) {
    list.sort((a, b) => b.scores.overall - a.scores.overall);
    list.forEach((s, i) => { s.rank = { position: i + 1, of: list.length }; });
  }
  return new Map(scored.map((s) => [s.id, s]));
}
export type TeamResult = ReturnType<typeof evaluateTeam> extends Map<string, infer V> ? V : never;
