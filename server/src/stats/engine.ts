/**
 * "Fighter card" stats — pure functions turning raw HR/ops numbers into 0–99 attributes.
 * Attributes without data (e.g. SPD for non-servers) are null and excluded from OVR.
 */

export interface StatInput {
  scheduledDays: number;
  daysPresent: number;
  lateCount: number;
  lateMinutes: number;
  daysAbsent: number;
  missingPunches: number;
  overtimeMinutes: number;
  approvedPenalties: number;
  warningNotes: number;
  noteRatingSum: number;
  efficiency: { slips: number; slipsPerHour: number; salesPerHour: number; avgServiceMinutes: number | null; voidRate: number } | null;
}

export interface TeamBaseline { slipsPerHour: number; salesPerHour: number; avgServiceMinutes: number }

export type AttrKey = 'PUN' | 'ATT' | 'SPD' | 'HUS' | 'SAL' | 'DIS' | 'REP';
export const ATTR_LABELS: Record<AttrKey, string> = {
  PUN: 'Punctuality', ATT: 'Attendance', SPD: 'Speed', HUS: 'Hustle', SAL: 'Sales', DIS: 'Discipline', REP: 'Reputation',
};
const WEIGHTS: Record<AttrKey, number> = { PUN: 0.2, ATT: 0.2, SPD: 0.12, HUS: 0.14, SAL: 0.1, DIS: 0.12, REP: 0.12 };

const clamp = (n: number) => Math.round(Math.max(1, Math.min(99, n)));

export function median(xs: number[]): number {
  const s = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeCard(i: StatInput, team: TeamBaseline) {
  const attrs: Record<AttrKey, number | null> = { PUN: null, ATT: null, SPD: null, HUS: null, SAL: null, DIS: null, REP: null };

  if (i.daysPresent > 0) {
    const lateRate = i.lateCount / i.daysPresent;
    const avgLate = i.lateMinutes / i.daysPresent;
    attrs.PUN = clamp(99 - lateRate * 120 - Math.min(30, avgLate));
  }
  if (i.scheduledDays > 0) {
    attrs.ATT = clamp((99 * Math.min(i.daysPresent, i.scheduledDays)) / i.scheduledDays - i.missingPunches * 4);
  }
  const e = i.efficiency;
  if (e && e.slips > 0) {
    if (e.avgServiceMinutes !== null && team.avgServiceMinutes > 0) {
      attrs.SPD = clamp(70 + ((team.avgServiceMinutes - e.avgServiceMinutes) / team.avgServiceMinutes) * 60);
    }
    if (team.slipsPerHour > 0) attrs.HUS = clamp((70 * e.slipsPerHour) / team.slipsPerHour);
    if (team.salesPerHour > 0) attrs.SAL = clamp((70 * e.salesPerHour) / team.salesPerHour);
  }
  attrs.DIS = clamp(99 - i.approvedPenalties * 8 - i.warningNotes * 15 - (e ? e.voidRate * 100 : 0));
  attrs.REP = clamp(70 + i.noteRatingSum * 6);

  let wsum = 0;
  let total = 0;
  for (const k of Object.keys(attrs) as AttrKey[]) {
    const v = attrs[k];
    if (v === null) continue;
    wsum += WEIGHTS[k];
    total += v * WEIGHTS[k];
  }
  const overall = wsum ? clamp(total / wsum) : 50;
  const tier = overall >= 90 ? 'legend' : overall >= 80 ? 'gold' : overall >= 65 ? 'silver' : 'bronze';
  return { overall, tier, attributes: attrs };
}
