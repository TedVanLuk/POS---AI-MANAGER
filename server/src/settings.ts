import type { TenantSettings } from './db/schema.js';

export const DEFAULT_SETTINGS: TenantSettings = {
  payroll: {
    frequency: 'semi_monthly',
    workDaysPerYear: 313,
    hoursPerDay: 8,
    statutorySchedule: 'split',
    components: {
      overtime: true,
      nightDifferential: true,
      holidayPay: true,
      restDayPay: true,
      lateDeduction: true,
      undertimeDeduction: true,
      absenceDeduction: true,
      sss: true,
      philhealth: true,
      pagibig: true,
      withholdingTax: true,
      thirteenthMonthAccrual: true,
      allowances: true,
      penalties: true,
    },
    nightDiffStart: '22:00',
    nightDiffEnd: '06:00',
    nightDiffRate: 0.1,
    minOvertimeMinutes: 30,
  },
};

/** Merge stored (possibly older) settings with defaults so new components get sane values. */
export function withDefaults(s: Partial<TenantSettings> | null | undefined): TenantSettings {
  return {
    payroll: {
      ...DEFAULT_SETTINGS.payroll,
      ...(s?.payroll ?? {}),
      components: { ...DEFAULT_SETTINGS.payroll.components, ...(s?.payroll?.components ?? {}) },
    },
  };
}
