import { DateTime } from 'luxon';
import type { DayRecord } from '../attendance/engine.js';
import type { TenantSettings } from '../db/schema.js';
import { deriveRates, otMultiplier, type EmployeePayInput } from '../payroll/engine.js';

/** Pure helpers for the admin dashboard, shared by the API and the in-browser demo. */

export interface DashEmployee extends EmployeePayInput { id: string; firstName: string; lastName: string; position: string | null }

/** Per-day head-count and hours across the team. */
export function dailyTrend(records: Map<string, DayRecord[]>, from: string, to: string) {
  const out: { date: string; present: number; late: number; absent: number; workedHours: number; lateMinutes: number }[] = [];
  for (let d = DateTime.fromISO(from); d.toISODate()! <= to; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    let present = 0, late = 0, absent = 0, worked = 0, lateMinutes = 0;
    for (const recs of records.values()) {
      const r = recs.find((x) => x.date === date);
      if (!r) continue;
      if (r.present) present++;
      if (r.lateMinutes > 0) late++;
      if (r.absent) absent++;
      worked += r.workedMinutes;
      lateMinutes += r.lateMinutes;
    }
    out.push({ date, present, late, absent, workedHours: Math.round(worked / 6) / 10, lateMinutes });
  }
  return out;
}

/** The pay period that contains `today` (semi-monthly 1–15 / 16–end, monthly, or Mon–Sun weekly). */
export function currentCutoff(today: string, frequency: TenantSettings['payroll']['frequency']) {
  const d = DateTime.fromISO(today);
  let start: DateTime, end: DateTime;
  if (frequency === 'monthly') { start = d.startOf('month'); end = d.endOf('month').startOf('day'); }
  else if (frequency === 'weekly') { start = d.startOf('week'); end = start.plus({ days: 6 }); }
  else if (d.day <= 15) { start = d.set({ day: 1 }); end = d.set({ day: 15 }); }
  else { start = d.set({ day: 16 }); end = d.endOf('month').startOf('day'); }
  const total = end.diff(start, 'days').days + 1;
  const done = d.diff(start, 'days').days + 1;
  return { start: start.toISODate()!, end: end.toISODate()!, elapsedPct: Math.round((done / total) * 100), daysLeft: Math.max(0, Math.round(total - done)) };
}

/** Overtime hours and estimated OT pay per employee for the given records (top first). */
export function overtimeLeaders(employees: DashEmployee[], records: Map<string, DayRecord[]>, settings: TenantSettings['payroll'], limit = 6) {
  return employees.map((e) => {
    const rates = deriveRates(e, settings);
    let minutes = 0, amount = 0, days = 0;
    for (const r of records.get(e.id) ?? []) {
      if (r.overtimeMinutes <= 0) continue;
      days++;
      minutes += r.overtimeMinutes;
      amount += (r.overtimeMinutes / 60) * rates.hourly * otMultiplier(r.dayType);
    }
    return { employeeId: e.id, name: `${e.firstName} ${e.lastName}`, position: e.position, minutes, days, amount: Math.round(amount * 100) / 100 };
  }).filter((x) => x.minutes > 0).sort((a, b) => b.amount - a.amount).slice(0, limit);
}
