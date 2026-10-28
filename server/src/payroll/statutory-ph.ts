import { round2 } from '../lib/money.js';

/**
 * Philippine statutory contribution & withholding-tax tables.
 * Effective-dated so future rate changes are added, never edited in place.
 * VERIFY against SSS / PhilHealth / HDMF / BIR circulars before each payroll year.
 */

export interface StatutoryTables {
  effectiveFrom: string;
  sss: { minMsc: number; maxMsc: number; step: number; eeRate: number; erRate: number; ecLow: number; ecHigh: number; ecThreshold: number };
  philhealth: { rate: number; floor: number; ceiling: number };
  pagibig: { eeRateLow: number; eeRate: number; erRate: number; lowThreshold: number; maxFundSalary: number };
  /** BIR withholding tax (TRAIN, 2023 onwards): [over, base tax, rate on excess]. */
  tax: Record<'monthly' | 'semi_monthly' | 'weekly', [number, number, number][]>;
}

export const PH_2025: StatutoryTables = {
  effectiveFrom: '2025-01-01',
  // SSS Circular 2024-006: 15% of MSC (EE 5%, ER 10%), MSC ₱5,000–₱35,000 in ₱500 steps; EC ₱10 / ₱30
  sss: { minMsc: 5000, maxMsc: 35000, step: 500, eeRate: 0.05, erRate: 0.10, ecLow: 10, ecHigh: 30, ecThreshold: 15000 },
  // PhilHealth: 5% of basic monthly salary shared 50/50, floor ₱10,000, ceiling ₱100,000
  philhealth: { rate: 0.05, floor: 10000, ceiling: 100000 },
  // Pag-IBIG (HDMF): EE 1% if ≤ ₱1,500 else 2%; ER 2%; max fund salary ₱10,000
  pagibig: { eeRateLow: 0.01, eeRate: 0.02, erRate: 0.02, lowThreshold: 1500, maxFundSalary: 10000 },
  tax: {
    monthly: [
      [0, 0, 0],
      [20833, 0, 0.15],
      [33333, 1875, 0.20],
      [66667, 8541.80, 0.25],
      [166667, 33541.80, 0.30],
      [666667, 183541.80, 0.35],
    ],
    semi_monthly: [
      [0, 0, 0],
      [10417, 0, 0.15],
      [16667, 937.50, 0.20],
      [33333, 4270.70, 0.25],
      [83333, 16770.70, 0.30],
      [333333, 91770.70, 0.35],
    ],
    weekly: [
      [0, 0, 0],
      [4808, 0, 0.15],
      [7692, 432.60, 0.20],
      [15385, 1971.20, 0.25],
      [38462, 7740.45, 0.30],
      [153846, 42355.65, 0.35],
    ],
  },
};

export const STATUTORY_TABLES: StatutoryTables[] = [PH_2025];

export function tablesFor(date: string): StatutoryTables {
  const applicable = STATUTORY_TABLES.filter((t) => t.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return applicable[0] ?? STATUTORY_TABLES[0];
}

/** Monthly Salary Credit: nearest ₱500 bracket (bracket = MSC−250 … MSC+249.99), clamped. */
export function sssMsc(monthlyCompensation: number, t = PH_2025.sss): number {
  const msc = t.step * Math.floor((monthlyCompensation + t.step / 2) / t.step);
  return Math.min(t.maxMsc, Math.max(t.minMsc, msc));
}

export function sssContribution(monthlyCompensation: number, t = PH_2025.sss) {
  const msc = sssMsc(monthlyCompensation, t);
  return {
    msc,
    ee: round2(msc * t.eeRate),
    er: round2(msc * t.erRate),
    ec: msc < t.ecThreshold ? t.ecLow : t.ecHigh,
  };
}

export function philhealthContribution(monthlyBasic: number, t = PH_2025.philhealth) {
  const base = Math.min(t.ceiling, Math.max(t.floor, monthlyBasic));
  const total = round2(base * t.rate);
  const ee = round2(total / 2);
  return { base, ee, er: round2(total - ee) };
}

export function pagibigContribution(monthlyBasic: number, t = PH_2025.pagibig) {
  const base = Math.min(t.maxFundSalary, monthlyBasic);
  const eeRate = monthlyBasic <= t.lowThreshold ? t.eeRateLow : t.eeRate;
  return { base, ee: round2(base * eeRate), er: round2(base * t.erRate) };
}

export function withholdingTax(taxableIncome: number, frequency: keyof StatutoryTables['tax'], tables = PH_2025): number {
  if (taxableIncome <= 0) return 0;
  const rows = tables.tax[frequency];
  let row = rows[0];
  for (const r of rows) if (taxableIncome > r[0]) row = r;
  const [over, base, rate] = row;
  return round2(base + (taxableIncome - over) * rate);
}
