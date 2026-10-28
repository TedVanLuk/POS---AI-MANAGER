import { describe, expect, it } from 'vitest';
import type { DayRecord } from '../attendance/engine.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { computePayslip, type ComputeInput } from './engine.js';

const base: DayRecord = {
  date: '2026-10-01', weekday: 4, dayType: 'ordinary', scheduled: true, holiday: null, present: true, absent: false,
  firstIn: null, lastOut: null, workedMinutes: 540, regularMinutes: 480, overtimeMinutes: 0, nightDiffMinutes: 0,
  nightDiffOtMinutes: 0, lateMinutes: 0, undertimeMinutes: 0, missingOut: false, missingIn: false,
};
const mk = (n: number, o: Partial<DayRecord> = {}): DayRecord => ({ ...base, date: `2026-10-${String(n).padStart(2, '0')}`, ...o });
const settings = DEFAULT_SETTINGS.payroll;
const line = (r: ReturnType<typeof computePayslip>, code: string) => r.lines.find((l) => l.code === code);

describe('daily-paid employee, semi-monthly cutoff 1', () => {
  const days: DayRecord[] = [
    ...Array.from({ length: 10 }, (_, i) => mk(i + 1)),
  ];
  days[1] = mk(2, { lateMinutes: 30, regularMinutes: 450 });
  days[2] = mk(3, { overtimeMinutes: 120 });
  days.push(mk(12, { present: false, absent: true, regularMinutes: 0, workedMinutes: 0 }));
  days.push(mk(13, { dayType: 'regular_holiday', holiday: 'regular' }));

  const input: ComputeInput = {
    employee: { payType: 'daily', rate: 700, allowances: [], exemptions: {} },
    days,
    settings,
    run: { frequency: 'semi_monthly', cutoff: 1, periodStart: '2026-10-01', periodEnd: '2026-10-15' },
  };
  const r = computePayslip(input);

  it('pays basic for days present on ordinary days', () => {
    expect(line(r, 'BASIC')).toMatchObject({ quantity: 10, amount: 7000 });
  });
  it('pays 200% for regular holiday work', () => {
    expect(line(r, 'PREM_REGULAR_HOLIDAY')?.amount).toBe(1400);
  });
  it('pays 125% overtime on ordinary days', () => {
    expect(line(r, 'OT_ORDINARY')?.amount).toBe(218.75);
  });
  it('deducts tardiness per minute', () => {
    expect(line(r, 'LATE')?.amount).toBe(43.75);
  });
  it('splits statutory contributions across cutoffs', () => {
    expect(line(r, 'SSS_EE')?.amount).toBe(462.5);
    expect(line(r, 'SSS_ER')?.amount).toBe(925);
    expect(line(r, 'PHILHEALTH_EE')?.amount).toBe(228.23);
    expect(line(r, 'PAGIBIG_EE')?.amount).toBe(100);
  });
  it('is below the tax threshold and totals correctly', () => {
    expect(line(r, 'WTAX')).toBeUndefined();
    expect(r.gross).toBe(8618.75);
    expect(r.totalDeductions).toBe(834.48);
    expect(r.net).toBe(7784.27);
    expect(line(r, 'THIRTEENTH_ACCRUAL')?.amount).toBe(579.69);
  });
  it('drops components switched off by the admin', () => {
    const off = computePayslip({ ...input, settings: { ...settings, components: { ...settings.components, overtime: false, sss: false } } });
    expect(line(off, 'OT_ORDINARY')).toBeUndefined();
    expect(line(off, 'SSS_EE')).toBeUndefined();
  });
  it('deducts approved penalties after tax', () => {
    const withPenalty = computePayslip({ ...input, penalties: [{ id: 'p1', date: '2026-10-02', amount: 100, reason: 'Late (16–30 min)', kind: 'late' }] });
    expect(withPenalty.net).toBe(7684.27);
    expect(withPenalty.summary.taxableIncome).toBe(r.summary.taxableIncome);
  });
});

describe('monthly-paid employee with withholding tax', () => {
  const input: ComputeInput = {
    employee: { payType: 'monthly', rate: 50000, allowances: [{ code: 'rice', label: 'Rice subsidy', amount: 1000 }], exemptions: {} },
    days: [],
    settings,
    run: { frequency: 'semi_monthly', cutoff: 2, periodStart: '2026-10-16', periodEnd: '2026-10-31' },
  };
  const r = computePayslip(input);

  it('computes tax on income net of employee contributions; non-taxable allowance excluded', () => {
    expect(line(r, 'BASIC')?.amount).toBe(25000);
    expect(line(r, 'SSS_EE')?.amount).toBe(875);
    expect(line(r, 'PHILHEALTH_EE')?.amount).toBe(625);
    expect(r.summary.taxableIncome).toBe(23400);
    expect(line(r, 'WTAX')?.amount).toBe(2284.1);
    expect(r.gross).toBe(26000);
    expect(r.net).toBe(22115.9);
  });

  it('re-computes tax when an admin disables a line', () => {
    const edited = computePayslip({ ...input, overrides: { SSS_EE: { enabled: false } } });
    expect(line(edited, 'SSS_EE')?.enabled).toBe(false);
    expect(line(edited, 'WTAX')?.amount).toBe(2459.1);
    expect(edited.net).toBe(22815.9);
  });

  it('keeps manual amount overrides', () => {
    const edited = computePayslip({ ...input, overrides: { WTAX: { amount: 2000 } } });
    expect(line(edited, 'WTAX')).toMatchObject({ amount: 2000, isManual: true });
    expect(edited.net).toBe(22400);
  });

  it('defers statutory deductions to the 2nd cutoff when configured', () => {
    const c1 = computePayslip({ ...input, run: { ...input.run, cutoff: 1 }, settings: { ...settings, statutorySchedule: 'second_cutoff' } });
    const c2 = computePayslip({ ...input, settings: { ...settings, statutorySchedule: 'second_cutoff' } });
    expect(line(c1, 'SSS_EE')).toBeUndefined();
    expect(line(c2, 'SSS_EE')?.amount).toBe(1750);
  });

  it('deducts absences for monthly-paid employees', () => {
    const abs = computePayslip({ ...input, days: [mk(20, { present: false, absent: true, regularMinutes: 0 })] });
    expect(line(abs, 'ABSENCE')?.amount).toBe(1916.93);
  });
});
