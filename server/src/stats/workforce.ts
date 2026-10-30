import { DateTime } from 'luxon';
import { dayTypeFor, type DayType, type HolidayInput } from '../attendance/engine.js';
import type { TenantSettings } from '../db/schema.js';
import { round2 } from '../lib/money.js';
import { DAY_MULTIPLIER, deriveRates, type EmployeePayInput } from '../payroll/engine.js';
import { pagibigContribution, philhealthContribution, sssContribution, type StatutoryTables } from '../payroll/statutory-ph.js';

/**
 * Pure workforce-planning helpers: who is scheduled each day of a week, head-count per
 * department, what a working day costs, and "what if" head-count projections.
 */

export interface PlanEmployee extends EmployeePayInput {
  id: string; firstName: string; lastName: string; position: string | null; department: string | null; photoUrl?: string | null;
  schedule: { name: string; startTime: string; endTime: string; restDays: number[] } | null;
}

export const DEFAULT_PLAN_SCHEDULE = { name: 'Default 09:00–18:00', startTime: '09:00', endTime: '18:00', restDays: [7] };
const WEEKS_PER_MONTH = 52 / 12;
const WEEKS_PER_YEAR = 52;

/** Cost of one ordinary working day for an employee: wage + employer statutory share. */
export function dailyCost(e: EmployeePayInput, settings: TenantSettings['payroll'], tables: StatutoryTables) {
  const rates = deriveRates(e, settings);
  const c = settings.components;
  let employerMonthly = 0;
  if (c.sss && !e.exemptions.sss) { const x = sssContribution(rates.monthly, tables.sss); employerMonthly += x.er + x.ec; }
  if (c.philhealth && !e.exemptions.philhealth) employerMonthly += philhealthContribution(rates.monthly, tables.philhealth).er;
  if (c.pagibig && !e.exemptions.pagibig) employerMonthly += pagibigContribution(rates.monthly, tables.pagibig).er;
  const allowancesMonthly = c.allowances ? e.allowances.reduce((a, x) => a + x.amount, 0) * 2 : 0; // allowances are per semi-monthly cutoff
  const perDay = (monthly: number) => (monthly * 12) / settings.workDaysPerYear;
  const wage = rates.daily;
  const employer = perDay(employerMonthly);
  const allowances = perDay(allowancesMonthly);
  return { wage: round2(wage), employer: round2(employer), allowances: round2(allowances), total: round2(wage + employer + allowances) };
}

export interface PlanDay { date: string; weekday: number; holiday: HolidayInput | null }

/** One week (Mon–Sun) of the roster, with per-day department head-count and cost. */
export function weeklyPlan(employees: PlanEmployee[], weekStart: string, holidays: (HolidayInput & { name?: string })[], settings: TenantSettings['payroll'], tables: StatutoryTables) {
  const start = DateTime.fromISO(weekStart).startOf('week');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = start.plus({ days: i });
    const date = d.toISODate()!;
    const h = holidays.find((x) => x.date === date) ?? null;
    return { date, weekday: d.weekday, holiday: h ? { date, type: h.type, name: (h as { name?: string }).name ?? '' } : null };
  });

  const rows = employees.map((e) => {
    const sch = e.schedule ?? DEFAULT_PLAN_SCHEDULE;
    const cost = dailyCost(e, settings, tables);
    const cells = days.map((d) => {
      const working = !sch.restDays.includes(d.weekday);
      const dayType: DayType = dayTypeFor(!working, d.holiday?.type ?? null);
      // Premium days cost more: 200% regular holiday, 130% special day (on scheduled days).
      const multiplier = working ? DAY_MULTIPLIER[dayType] : 0;
      return { date: d.date, working, dayType, shift: working ? `${sch.startTime.slice(0, 5)}–${sch.endTime.slice(0, 5)}` : null, cost: round2(working ? cost.wage * multiplier + cost.employer + cost.allowances : 0) };
    });
    return { employeeId: e.id, name: `${e.firstName} ${e.lastName}`, position: e.position, department: e.department ?? 'Unassigned', photoUrl: e.photoUrl ?? null, payType: e.payType, schedule: sch.name, dailyCost: cost, cells, weekCost: round2(cells.reduce((a, c) => a + c.cost, 0)) };
  });

  const departments = [...new Set(rows.map((r) => r.department))].sort();
  const byDepartment = departments.map((dep) => {
    const people = rows.filter((r) => r.department === dep);
    return {
      department: dep,
      people: people.length,
      /** Average cost of one person-day in this department on an ordinary day. */
      avgDailyCost: round2(people.reduce((a, r) => a + r.dailyCost.total, 0) / Math.max(1, people.length)),
      perDay: days.map((d, i) => ({ date: d.date, count: people.filter((r) => r.cells[i].working).length, cost: round2(people.reduce((a, r) => a + r.cells[i].cost, 0)) })),
    };
  });
  const totals = days.map((d, i) => ({ date: d.date, count: rows.filter((r) => r.cells[i].working).length, cost: round2(rows.reduce((a, r) => a + r.cells[i].cost, 0)) }));
  const weekCost = round2(totals.reduce((a, t) => a + t.cost, 0));
  return { weekStart: start.toISODate()!, days, rows, byDepartment, totals, weekCost, monthCost: round2(weekCost * WEEKS_PER_MONTH), yearCost: round2(weekCost * WEEKS_PER_YEAR) };
}

export type WeeklyPlan = ReturnType<typeof weeklyPlan>;

/**
 * "What if" head-count: `counts[department][dayIndex]` = people wanted that day.
 * Each extra (or removed) person costs the department's average day cost × that day's premium.
 */
export function projectHeadcount(plan: WeeklyPlan, counts: Record<string, number[]>) {
  const perDay = plan.days.map((d, i) => {
    const mult = d.holiday ? DAY_MULTIPLIER[dayTypeFor(false, d.holiday.type)] : 1;
    let cost = 0, count = 0;
    for (const dep of plan.byDepartment) {
      const base = dep.perDay[i];
      const want = Math.max(0, Math.round(counts[dep.department]?.[i] ?? base.count));
      const delta = want - base.count;
      count += want;
      // Removing people saves their actual average cost on that day; adding uses the department average.
      const avgToday = base.count ? base.cost / base.count : dep.avgDailyCost * mult;
      cost += base.cost + delta * (delta < 0 ? avgToday : dep.avgDailyCost * mult);
    }
    return { date: d.date, count, cost: round2(Math.max(0, cost)), baseline: plan.totals[i].cost, baselineCount: plan.totals[i].count };
  });
  const week = round2(perDay.reduce((a, d) => a + d.cost, 0));
  const diff = (scenario: number, base: number) => round2(scenario - base);
  const periods = {
    day: { scenario: round2(week / 7), baseline: round2(plan.weekCost / 7) },
    week: { scenario: week, baseline: plan.weekCost },
    month: { scenario: round2(week * WEEKS_PER_MONTH), baseline: plan.monthCost },
    year: { scenario: round2(week * WEEKS_PER_YEAR), baseline: plan.yearCost },
  };
  return {
    perDay,
    periods: Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, { ...v, difference: diff(v.scenario, v.baseline) }])) as Record<keyof typeof periods, { scenario: number; baseline: number; difference: number }>,
  };
}
