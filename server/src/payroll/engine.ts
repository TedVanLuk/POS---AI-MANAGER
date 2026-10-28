import type { DayRecord, DayType } from '../attendance/engine.js';
import { summarize } from '../attendance/engine.js';
import type { TenantSettings } from '../db/schema.js';
import { round2, sum } from '../lib/money.js';
import {
  pagibigContribution, philhealthContribution, sssContribution, tablesFor, withholdingTax, type StatutoryTables,
} from './statutory-ph.js';

/**
 * Pure payroll engine (Philippines). Given attendance day records and settings,
 * produces explainable payslip lines. Manual overrides from admins are applied
 * BEFORE dependent lines (tax, totals) are calculated, so edits flow through.
 */

export type LineCategory = 'earning' | 'deduction' | 'employer' | 'info';

export interface PayLine {
  code: string;
  label: string;
  category: LineCategory;
  quantity: number | null;
  rate: number | null;
  amount: number;
  /** Earnings: counts toward taxable compensation. Deductions: reduces taxable compensation. */
  taxable: boolean;
  enabled: boolean;
  isManual: boolean;
  sortOrder: number;
}

export interface EmployeePayInput {
  payType: 'monthly' | 'daily' | 'hourly';
  rate: number;
  allowances: { code: string; label: string; amount: number; taxable?: boolean }[];
  exemptions: { withholdingTax?: boolean; sss?: boolean; philhealth?: boolean; pagibig?: boolean };
}

export interface RunInput {
  frequency: 'semi_monthly' | 'monthly' | 'weekly';
  cutoff: number;
  periodStart: string;
  periodEnd: string;
}

export interface PenaltyInput { id: string; date: string; amount: number; reason: string; kind: string }

/** Admin overrides keyed by line code (from previously saved lines). */
export interface LineOverride { enabled?: boolean; amount?: number; label?: string }

export interface ComputeInput {
  employee: EmployeePayInput;
  days: DayRecord[];
  settings: TenantSettings['payroll'];
  run: RunInput;
  penalties?: PenaltyInput[];
  overrides?: Record<string, LineOverride>;
  /** Lines added by hand (code starts with MANUAL_). */
  manualLines?: PayLine[];
  tables?: StatutoryTables;
}

export interface ComputeResult {
  lines: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  rates: { monthly: number; daily: number; hourly: number; minute: number };
  summary: ReturnType<typeof summarize> & { taxableIncome: number };
}

/** Premium multiplier of the day's rate for hours worked (Labor Code / DOLE Handbook). */
export const DAY_MULTIPLIER: Record<DayType, number> = {
  ordinary: 1.0,
  rest: 1.3,
  special: 1.3,
  special_rest: 1.5,
  regular_holiday: 2.0,
  regular_holiday_rest: 2.6,
};

const DAY_LABEL: Record<DayType, string> = {
  ordinary: 'Regular day',
  rest: 'Rest day work',
  special: 'Special holiday work',
  special_rest: 'Special holiday on rest day',
  regular_holiday: 'Regular holiday work',
  regular_holiday_rest: 'Regular holiday on rest day',
};

export function deriveRates(e: EmployeePayInput, s: TenantSettings['payroll']) {
  let daily: number;
  let monthly: number;
  if (e.payType === 'monthly') {
    monthly = e.rate;
    daily = (e.rate * 12) / s.workDaysPerYear;
  } else if (e.payType === 'daily') {
    daily = e.rate;
    monthly = (e.rate * s.workDaysPerYear) / 12;
  } else {
    daily = e.rate * s.hoursPerDay;
    monthly = (daily * s.workDaysPerYear) / 12;
  }
  const hourly = daily / s.hoursPerDay;
  return { monthly: round2(monthly), daily: round2(daily), hourly, minute: hourly / 60 };
}

/** Share of a monthly amount that falls in this run. */
function periodShare(run: RunInput, schedule: TenantSettings['payroll']['statutorySchedule']): number {
  if (run.frequency === 'monthly') return 1;
  if (run.frequency === 'weekly') return 12 / 52;
  if (schedule === 'second_cutoff') return run.cutoff === 2 ? 1 : 0;
  return 0.5;
}

export function computePayslip(input: ComputeInput): ComputeResult {
  const { employee: emp, days, settings: s, run } = input;
  const c = s.components;
  const tables = input.tables ?? tablesFor(run.periodEnd);
  const overrides = input.overrides ?? {};
  const rates = deriveRates(emp, s);
  const totals = summarize(days);
  const lines: PayLine[] = [];
  let order = 0;

  const add = (l: Omit<PayLine, 'enabled' | 'isManual' | 'sortOrder' | 'amount'> & { amount: number }) => {
    const o = overrides[l.code];
    if (l.amount === 0 && l.code !== 'BASIC' && o?.amount === undefined) return;
    lines.push({
      ...l,
      label: o?.label ?? l.label,
      amount: o?.amount !== undefined ? round2(o.amount) : round2(l.amount),
      enabled: o?.enabled ?? true,
      isManual: o?.amount !== undefined,
      sortOrder: order++,
    });
  };
  const hrs = (min: number) => round2(min / 60);

  const holidayPayOn = c.holidayPay;
  const restPayOn = c.restDayPay;
  const effectiveType = (d: DayRecord): DayType => {
    let t = d.dayType;
    if (!holidayPayOn) t = t === 'regular_holiday_rest' || t === 'special_rest' ? 'rest' : t === 'regular_holiday' || t === 'special' ? 'ordinary' : t;
    if (!restPayOn) t = t === 'rest' ? 'ordinary' : t === 'special_rest' ? 'special' : t === 'regular_holiday_rest' ? 'regular_holiday' : t;
    return t;
  };

  // ---------- Basic pay ----------
  const ordinaryDays = days.filter((d) => effectiveType(d) === 'ordinary');
  if (emp.payType === 'monthly') {
    const basic = run.frequency === 'monthly' ? rates.monthly : run.frequency === 'weekly' ? (rates.monthly * 12) / 52 : rates.monthly / 2;
    add({ code: 'BASIC', label: 'Basic salary', category: 'earning', quantity: null, rate: null, amount: basic, taxable: true });
  } else {
    const present = ordinaryDays.filter((d) => d.present).length;
    add({ code: 'BASIC', label: 'Basic pay (days worked)', category: 'earning', quantity: present, rate: rates.daily, amount: present * rates.daily, taxable: true });
  }

  // ---------- Rest day / holiday work premiums ----------
  const premiumByType = new Map<DayType, number>();
  for (const d of days) {
    const t = effectiveType(d);
    if (t === 'ordinary' || d.regularMinutes === 0) continue;
    premiumByType.set(t, (premiumByType.get(t) ?? 0) + d.regularMinutes);
  }
  for (const [t, minutes] of premiumByType) {
    // Monthly-paid salary already includes holidays (not rest days), so only the premium part is added.
    const includedInSalary = emp.payType === 'monthly' && (t === 'regular_holiday' || t === 'special') ? 1 : 0;
    const mult = DAY_MULTIPLIER[t] - includedInSalary;
    const code = `PREM_${t.toUpperCase()}`;
    add({ code, label: `${DAY_LABEL[t]} (${Math.round(DAY_MULTIPLIER[t] * 100)}%)`, category: 'earning', quantity: hrs(minutes), rate: round2(rates.hourly * mult), amount: (minutes / 60) * rates.hourly * mult, taxable: true });
  }

  // Unworked regular holiday — daily/hourly-paid only (monthly salary already covers it).
  if (holidayPayOn && emp.payType !== 'monthly') {
    const eligible = days.filter((d, i) => {
      if (d.dayType !== 'regular_holiday' || d.present) return false;
      // Must be present on the last scheduled workday before the holiday (if inside the period).
      const prev = [...days.slice(0, i)].reverse().find((p) => p.dayType === 'ordinary');
      return !prev || prev.present;
    }).length;
    add({ code: 'HOLIDAY_UNWORKED', label: 'Regular holiday pay (unworked)', category: 'earning', quantity: eligible, rate: rates.daily, amount: eligible * rates.daily, taxable: true });
  }

  // ---------- Overtime ----------
  if (c.overtime) {
    const otByType = new Map<DayType, number>();
    for (const d of days) if (d.overtimeMinutes > 0) otByType.set(effectiveType(d), (otByType.get(effectiveType(d)) ?? 0) + d.overtimeMinutes);
    for (const [t, minutes] of otByType) {
      const mult = otMultiplier(t);
      add({ code: `OT_${t.toUpperCase()}`, label: `Overtime – ${DAY_LABEL[t]} (${Math.round(mult * 100)}%)`, category: 'earning', quantity: hrs(minutes), rate: round2(rates.hourly * mult), amount: (minutes / 60) * rates.hourly * mult, taxable: true });
    }
  }

  // ---------- Night differential (10% of the applicable hourly rate) ----------
  if (c.nightDifferential) {
    let ndAmount = 0;
    let ndMinutes = 0;
    for (const d of days) {
      const t = effectiveType(d);
      ndAmount += (d.nightDiffMinutes / 60) * rates.hourly * DAY_MULTIPLIER[t] * s.nightDiffRate;
      if (c.overtime) ndAmount += (d.nightDiffOtMinutes / 60) * rates.hourly * otMultiplier(t) * s.nightDiffRate;
      ndMinutes += d.nightDiffMinutes + (c.overtime ? d.nightDiffOtMinutes : 0);
    }
    add({ code: 'NIGHT_DIFF', label: `Night differential (${Math.round(s.nightDiffRate * 100)}%)`, category: 'earning', quantity: hrs(ndMinutes), rate: round2(rates.hourly * s.nightDiffRate), amount: ndAmount, taxable: true });
  }

  // ---------- Allowances ----------
  if (c.allowances) {
    for (const a of emp.allowances) {
      add({ code: `ALLOW_${a.code.toUpperCase()}`, label: a.label, category: 'earning', quantity: null, rate: null, amount: a.amount, taxable: !!a.taxable });
    }
  }

  // ---------- Attendance deductions ----------
  if (c.absenceDeduction && emp.payType === 'monthly') {
    add({ code: 'ABSENCE', label: 'Absences', category: 'deduction', quantity: totals.daysAbsent, rate: rates.daily, amount: totals.daysAbsent * rates.daily, taxable: true });
  }
  if (c.lateDeduction) {
    add({ code: 'LATE', label: 'Tardiness', category: 'deduction', quantity: totals.lateMinutes, rate: round2(rates.minute), amount: totals.lateMinutes * rates.minute, taxable: true });
  }
  if (c.undertimeDeduction) {
    add({ code: 'UNDERTIME', label: 'Undertime', category: 'deduction', quantity: totals.undertimeMinutes, rate: round2(rates.minute), amount: totals.undertimeMinutes * rates.minute, taxable: true });
  }

  // Manual lines are added before statutory/tax so they flow into taxable income.
  for (const m of input.manualLines ?? []) lines.push({ ...m, sortOrder: 500 + order++ });

  // ---------- Statutory contributions ----------
  const share = periodShare(run, s.statutorySchedule);
  const statutory = (code: string, label: string, ee: number, er: number, erCode: string, erLabel: string) => {
    add({ code, label, category: 'deduction', quantity: null, rate: null, amount: ee * share, taxable: true });
    add({ code: erCode, label: erLabel, category: 'employer', quantity: null, rate: null, amount: er * share, taxable: false });
  };
  if (c.sss && !emp.exemptions.sss) {
    const x = sssContribution(rates.monthly, tables.sss);
    statutory('SSS_EE', `SSS (MSC ₱${x.msc.toLocaleString('en-PH')})`, x.ee, x.er, 'SSS_ER', 'SSS – employer share');
    add({ code: 'SSS_EC', label: 'SSS EC – employer', category: 'employer', quantity: null, rate: null, amount: x.ec * share, taxable: false });
  }
  if (c.philhealth && !emp.exemptions.philhealth) {
    const x = philhealthContribution(rates.monthly, tables.philhealth);
    statutory('PHILHEALTH_EE', 'PhilHealth', x.ee, x.er, 'PHILHEALTH_ER', 'PhilHealth – employer share');
  }
  if (c.pagibig && !emp.exemptions.pagibig) {
    const x = pagibigContribution(rates.monthly, tables.pagibig);
    statutory('PAGIBIG_EE', 'Pag-IBIG', x.ee, x.er, 'PAGIBIG_ER', 'Pag-IBIG – employer share');
  }

  // ---------- Withholding tax (on taxable compensation after EE contributions) ----------
  const active = () => lines.filter((l) => l.enabled);
  const taxableEarnings = sum(active().filter((l) => l.category === 'earning' && l.taxable).map((l) => l.amount));
  const taxReducing = sum(active().filter((l) => l.category === 'deduction' && l.taxable).map((l) => l.amount));
  const taxableIncome = round2(Math.max(0, taxableEarnings - taxReducing));
  if (c.withholdingTax && !emp.exemptions.withholdingTax) {
    const tax = withholdingTax(taxableIncome, run.frequency, tables);
    add({ code: 'WTAX', label: 'Withholding tax', category: 'deduction', quantity: null, rate: null, amount: tax, taxable: false });
  }

  // ---------- Penalties (post-tax) ----------
  if (c.penalties) {
    for (const p of input.penalties ?? []) {
      add({ code: `PENALTY_${p.id}`, label: `Penalty ${p.date}: ${p.reason}`, category: 'deduction', quantity: null, rate: null, amount: p.amount, taxable: false });
    }
  }

  // ---------- 13th month accrual (info only) ----------
  if (c.thirteenthMonthAccrual) {
    const basicEarned = sum(active().filter((l) => ['BASIC'].includes(l.code)).map((l) => l.amount))
      - sum(active().filter((l) => ['ABSENCE', 'LATE', 'UNDERTIME'].includes(l.code)).map((l) => l.amount));
    add({ code: 'THIRTEENTH_ACCRUAL', label: '13th month accrual (basic ÷ 12)', category: 'info', quantity: null, rate: null, amount: Math.max(0, basicEarned) / 12, taxable: false });
  }

  const gross = sum(active().filter((l) => l.category === 'earning').map((l) => l.amount));
  const totalDeductions = sum(active().filter((l) => l.category === 'deduction').map((l) => l.amount));
  return {
    lines,
    gross,
    totalDeductions,
    net: round2(gross - totalDeductions),
    rates,
    summary: { ...totals, taxableIncome },
  };
}

export function otMultiplier(t: DayType): number {
  return t === 'ordinary' ? 1.25 : DAY_MULTIPLIER[t] * 1.3;
}
