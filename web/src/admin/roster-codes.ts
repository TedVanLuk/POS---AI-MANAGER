import { isOnDuty } from '../../../server/src/stats/roster';

/** Schedule statuses as used on the MDC weekly schedule. `cls` picks the cell colour. */
export const CODE_OPTIONS: { code: string; label: string; cls: string }[] = [
  { code: 'D', label: 'DUTY', cls: 'duty' },
  { code: 'O', label: 'OFF', cls: 'off' },
  { code: 'A', label: 'ALL IN', cls: 'allin' },
  { code: 'L', label: 'ON LEAVE', cls: 'leave' },
  { code: 'R', label: 'RECEPT', cls: 'recept' },
  { code: 'N', label: 'N/A', cls: 'na' },
  { code: 'X', label: 'NO DUTY', cls: 'na' },
  { code: '', label: '—', cls: 'blank' },
];

export function codeInfo(code: string) {
  return CODE_OPTIONS.find((o) => o.code === code) ?? { code, label: code, cls: 'time' };
}

/** Working days in a usual week and the implied monthly pay for a daily rate (week × 52 ÷ 12). */
export function workWeek(pattern: string[] | undefined) {
  const days = (pattern ?? []).filter(isOnDuty).length;
  return { days, offs: pattern?.length === 7 ? 7 - days : null };
}
export const monthlyFromDaily = (daily: number, daysPerWeek: number) => Math.round((daily * daysPerWeek * 52) / 12);
export { isOnDuty };
