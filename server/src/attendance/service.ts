import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, schema } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { withDefaults } from '../settings.js';
import { buildDailyRecords, summarize, type DayRecord, type ScheduleInput } from './engine.js';

export const DEFAULT_SCHEDULE: ScheduleInput = { startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] };

export async function getTenant(tenantId: string) {
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  if (!t) throw notFound('Tenant');
  return { ...t, settings: withDefaults(t.settings) };
}

/**
 * Build per-day attendance records for employees of a tenant over a date range.
 * Returns a map employeeId → DayRecord[].
 */
export async function getDayRecords(tenantId: string, from: string, to: string, employeeIds?: string[], now?: Date) {
  const tenant = await getTenant(tenantId);
  const tz = tenant.timezone;
  const emps = await db.select().from(schema.employees).where(and(
    eq(schema.employees.tenantId, tenantId),
    employeeIds ? inArray(schema.employees.id, employeeIds.length ? employeeIds : ['00000000-0000-0000-0000-000000000000']) : eq(schema.employees.active, true),
  ));
  const schedules = await db.select().from(schema.workSchedules).where(eq(schema.workSchedules.tenantId, tenantId));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const holidays = await db.select().from(schema.holidays).where(and(
    eq(schema.holidays.tenantId, tenantId), gte(schema.holidays.date, from), lte(schema.holidays.date, to),
  ));
  // Load a little beyond the range so overnight sessions close properly.
  const rangeStart = DateTime.fromISO(from, { zone: tz }).startOf('day').toJSDate();
  const rangeEnd = DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }).endOf('day').toJSDate();
  const punches = emps.length ? await db.select().from(schema.attendancePunches).where(and(
    eq(schema.attendancePunches.tenantId, tenantId),
    inArray(schema.attendancePunches.employeeId, emps.map((e) => e.id)),
    eq(schema.attendancePunches.voided, false),
    gte(schema.attendancePunches.punchedAt, rangeStart),
    lte(schema.attendancePunches.punchedAt, rangeEnd),
  )) : [];

  const result = new Map<string, DayRecord[]>();
  for (const e of emps) {
    const s = e.scheduleId ? scheduleById.get(e.scheduleId) : undefined;
    const schedule: ScheduleInput = s
      ? { startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, graceMinutes: s.graceMinutes, restDays: s.restDays }
      : DEFAULT_SCHEDULE;
    const records = buildDailyRecords({
      punches: punches.filter((p) => p.employeeId === e.id).map((p) => ({ type: p.type, at: p.punchedAt })),
      schedule,
      holidays: holidays.map((h) => ({ date: h.date, type: h.type })),
      periodStart: from,
      periodEnd: to,
      options: {
        timezone: tz,
        hoursPerDay: tenant.settings.payroll.hoursPerDay,
        nightDiffStart: tenant.settings.payroll.nightDiffStart,
        nightDiffEnd: tenant.settings.payroll.nightDiffEnd,
        minOvertimeMinutes: tenant.settings.payroll.minOvertimeMinutes,
        hireDate: e.hireDate,
        now,
      },
    });
    result.set(e.id, records);
  }
  return { tenant, employees: emps, records: result };
}

/** Monday–Sunday of the current week in the tenant timezone. */
export function currentWeek(tz: string, ref = new Date()) {
  const d = DateTime.fromJSDate(ref, { zone: tz });
  const start = d.startOf('week');
  return { from: start.toISODate()!, to: start.plus({ days: 6 }).toISODate()! };
}

/** The compact "my week" card shown on the kiosk and employee portal. */
export async function weekSummary(tenantId: string, employeeId: string) {
  const tenant = await getTenant(tenantId);
  const { from, to } = currentWeek(tenant.timezone);
  const { records } = await getDayRecords(tenantId, from, to, [employeeId]);
  const days = records.get(employeeId) ?? [];
  const totals = summarize(days);
  return {
    from,
    to,
    days: days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      dayType: d.dayType,
      present: d.present,
      absent: d.absent,
      firstIn: d.firstIn,
      lastOut: d.lastOut,
      lateMinutes: d.lateMinutes,
      workedMinutes: d.workedMinutes,
      missingOut: d.missingOut,
    })),
    daysWorked: totals.daysPresent,
    lateCount: totals.lateCount,
    lateMinutes: totals.lateMinutes,
    workedHours: Math.round((totals.workedMinutes / 60) * 10) / 10,
  };
}
