import { DateTime } from 'luxon';
import { round2 } from '../lib/money.js';

/**
 * Pure roster engine for the weekly staff schedule (the "MDC schedule" format):
 * every employee has a usual week (Mon→Sun codes); single days can be changed per week.
 * Totals per department per day, the department daily rate ("Amount") and the
 * estimated payroll (person-days × amount) follow the client's spreadsheet.
 */

export const ROSTER_CODES = {
  D: { label: 'DUTY', counts: true },
  A: { label: 'ALL IN', counts: true },
  R: { label: 'RECEPT', counts: true },
  O: { label: 'OFF', counts: false },
  L: { label: 'ON LEAVE', counts: false },
  N: { label: 'N/A', counts: false },
  X: { label: 'NO DUTY', counts: false },
  '': { label: '—', counts: false },
} as const;
export type RosterCode = keyof typeof ROSTER_CODES;

/** A code is either a known status or free text (a DJ/MC set time like "10-1:30"), which counts as on duty. */
export function isOnDuty(code: string | undefined | null): boolean {
  const c = (code ?? '').trim();
  if (c in ROSTER_CODES) return ROSTER_CODES[c as RosterCode].counts;
  return c.length > 0;
}
export const codeLabel = (code: string) => (code in ROSTER_CODES ? ROSTER_CODES[code as RosterCode].label : code);

export interface RosterDepartment { name: string; group: string; dailyRate: number }
export interface RosterEmployee { id: string; name: string; department: string | null; position: string | null; photoUrl?: string | null; weekPattern: string[]; dailyRate: number }
export interface RosterEntry { employeeId: string; date: string; code: string }

const WEEKS_PER_MONTH = 52 / 12;
const WEEKS_PER_YEAR = 52;

export function rosterWeek(params: { employees: RosterEmployee[]; entries: RosterEntry[]; departments: RosterDepartment[]; weekStart: string }) {
  const start = DateTime.fromISO(params.weekStart).startOf('week');
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!);
  const entry = new Map(params.entries.map((e) => [`${e.employeeId}|${e.date}`, e.code]));
  const deptOrder = new Map(params.departments.map((d, i) => [d.name, i]));
  const deptNames = [...new Set([...params.departments.map((d) => d.name), ...params.employees.map((e) => e.department ?? 'Unassigned')])]
    .filter((n) => params.employees.some((e) => (e.department ?? 'Unassigned') === n))
    .sort((a, b) => (deptOrder.get(a) ?? 999) - (deptOrder.get(b) ?? 999) || a.localeCompare(b));

  const departments = deptNames.map((name) => {
    const cfg = params.departments.find((d) => d.name === name);
    const staff = params.employees.filter((e) => (e.department ?? 'Unassigned') === name);
    const rows = staff.map((e) => ({
      employeeId: e.id, name: e.name, position: e.position, photoUrl: e.photoUrl ?? null,
      cells: days.map((date, i) => {
        const override = entry.get(`${e.id}|${date}`);
        const code = override ?? e.weekPattern[i] ?? '';
        return { date, code, override: override !== undefined && override !== (e.weekPattern[i] ?? ''), onDuty: isOnDuty(code) };
      }),
    }));
    const totals = days.map((_, i) => rows.filter((r) => r.cells[i].onDuty).length);
    const dailyRate = cfg?.dailyRate ?? round2(staff.reduce((a, e) => a + e.dailyRate, 0) / Math.max(1, staff.length));
    const personDays = totals.reduce((a, n) => a + n, 0);
    return { name, group: cfg?.group ?? 'Other staff', dailyRate, rows, totals, personDays, estPayroll: round2(personDays * dailyRate) };
  });

  const groupNames = [...new Set(departments.map((d) => d.group))];
  const groups = groupNames.map((group) => {
    const deps = departments.filter((d) => d.group === group);
    const totals = days.map((_, i) => deps.reduce((a, d) => a + d.totals[i], 0));
    return { group, departments: deps.map((d) => d.name), totals, estPayroll: round2(deps.reduce((a, d) => a + d.estPayroll, 0)) };
  });
  const totals = days.map((_, i) => departments.reduce((a, d) => a + d.totals[i], 0));
  const estPayroll = round2(departments.reduce((a, d) => a + d.estPayroll, 0));
  return {
    weekStart: start.toISODate()!, days, departments, groups, totals, estPayroll,
    dayCost: days.map((_, i) => round2(departments.reduce((a, d) => a + d.totals[i] * d.dailyRate, 0))),
    monthly: round2(estPayroll * WEEKS_PER_MONTH), yearly: round2(estPayroll * WEEKS_PER_YEAR),
  };
}
export type RosterWeek = ReturnType<typeof rosterWeek>;

/** "What if" head-count per department per day → cost per day/week/month/year vs the schedule. */
export function projectRoster(week: RosterWeek, counts: Record<string, number[]>) {
  const want = (d: RosterWeek['departments'][number], i: number) => Math.max(0, Math.round(counts[d.name]?.[i] ?? d.totals[i]));
  const perDay = week.days.map((date, i) => ({
    date,
    count: week.departments.reduce((a, d) => a + want(d, i), 0),
    baselineCount: week.totals[i],
    cost: round2(week.departments.reduce((a, d) => a + want(d, i) * d.dailyRate, 0)),
    baseline: week.dayCost[i],
  }));
  const perDept = week.departments.map((d) => {
    const personDays = d.totals.reduce((a, _n, i) => a + want(d, i), 0);
    return { name: d.name, personDays, estPayroll: round2(personDays * d.dailyRate), baseline: d.estPayroll };
  });
  const weekCost = round2(perDay.reduce((a, d) => a + d.cost, 0));
  const period = (scenario: number, baseline: number) => ({ scenario: round2(scenario), baseline: round2(baseline), difference: round2(scenario - baseline) });
  return {
    perDay,
    perDept,
    periods: {
      day: period(weekCost / 7, week.estPayroll / 7),
      week: period(weekCost, week.estPayroll),
      month: period(weekCost * WEEKS_PER_MONTH, week.monthly),
      year: period(weekCost * WEEKS_PER_YEAR, week.yearly),
    },
  };
}

/** The roster code for one person on one date (week override, else their usual week). */
export function codeOn(pattern: string[], overrides: Map<string, string>, employeeId: string, date: string) {
  const o = overrides.get(`${employeeId}|${date}`);
  if (o !== undefined) return o;
  return pattern[DateTime.fromISO(date).weekday - 1] ?? '';
}

/** Rest days (ISO weekdays) implied by a usual week, for the attendance engine. */
export function restDaysFromPattern(pattern: string[]): number[] | null {
  if (pattern.length !== 7 || !pattern.some(isOnDuty)) return null;
  return pattern.map((c, i) => (isOnDuty(c) ? 0 : i + 1)).filter(Boolean);
}
