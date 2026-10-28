import { DateTime, Interval } from 'luxon';

/**
 * Pure attendance engine: turns raw punches into per-day records
 * (worked/regular/OT/night-diff/late/undertime/absence) in the tenant's timezone.
 * No database access — fully unit-testable.
 */

export type DayType =
  | 'ordinary'
  | 'rest'
  | 'special'
  | 'special_rest'
  | 'regular_holiday'
  | 'regular_holiday_rest';

export interface PunchInput { type: 'in' | 'out'; at: Date }
export interface ScheduleInput {
  startTime: string; // "HH:mm" or "HH:mm:ss"
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  restDays: number[]; // ISO weekday 1=Mon … 7=Sun
}
export interface HolidayInput { date: string; type: 'regular' | 'special_non_working' | 'special_working' }

export interface AttendanceOptions {
  timezone: string;
  hoursPerDay: number;
  nightDiffStart: string; // "22:00"
  nightDiffEnd: string; // "06:00"
  minOvertimeMinutes: number;
  /** Days after this instant are not marked absent (period still running). */
  now?: Date;
  /** Days before hire date are ignored. */
  hireDate?: string | null;
}

export interface DayRecord {
  date: string; // YYYY-MM-DD (local)
  weekday: number;
  dayType: DayType;
  scheduled: boolean; // a normal working day per schedule (not a rest day)
  holiday: HolidayInput['type'] | null;
  present: boolean;
  absent: boolean;
  firstIn: string | null; // ISO
  lastOut: string | null; // ISO
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  nightDiffMinutes: number; // within regular hours
  nightDiffOtMinutes: number; // within overtime
  lateMinutes: number;
  undertimeMinutes: number;
  missingOut: boolean;
  missingIn: boolean;
}

interface Session { start: DateTime; end: DateTime | null }

const OPEN_SESSION_STALE_HOURS = 16;

const parseHm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return { hour: h, minute: m };
};

export function dayTypeFor(isRestDay: boolean, holiday: HolidayInput['type'] | null): DayType {
  if (holiday === 'regular') return isRestDay ? 'regular_holiday_rest' : 'regular_holiday';
  if (holiday === 'special_non_working') return isRestDay ? 'special_rest' : 'special';
  // special working days are paid like ordinary days
  return isRestDay ? 'rest' : 'ordinary';
}

/** Pair raw punches into sessions, keyed by the local date of the IN punch. */
export function pairSessions(punches: PunchInput[], timezone: string) {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const byDate = new Map<string, Session[]>();
  const orphanOuts = new Set<string>();
  let open: Session | null = null;
  const push = (s: Session) => {
    const key = s.start.toISODate()!;
    byDate.set(key, [...(byDate.get(key) ?? []), s]);
  };
  for (const p of sorted) {
    const t = DateTime.fromJSDate(p.at, { zone: timezone });
    if (p.type === 'in') {
      if (open) push(open); // previous IN never closed
      open = { start: t, end: null };
    } else if (open) {
      open.end = t;
      push(open);
      open = null;
    } else {
      orphanOuts.add(t.toISODate()!);
    }
  }
  if (open) push(open);
  return { byDate, orphanOuts };
}

function overlapMinutes(a: Interval, b: Interval): number {
  const i = a.intersection(b);
  return i ? i.length('minutes') : 0;
}

function nightWindows(day: DateTime, opts: AttendanceOptions): Interval[] {
  const s = parseHm(opts.nightDiffStart);
  const e = parseHm(opts.nightDiffEnd);
  const wins: Interval[] = [];
  for (const offset of [-1, 0, 1]) {
    const base = day.plus({ days: offset });
    const start = base.set({ ...s, second: 0, millisecond: 0 });
    let end = base.set({ ...e, second: 0, millisecond: 0 });
    if (end <= start) end = end.plus({ days: 1 });
    wins.push(Interval.fromDateTimes(start, end));
  }
  return wins;
}

export function buildDailyRecords(params: {
  punches: PunchInput[];
  schedule: ScheduleInput;
  holidays: HolidayInput[];
  periodStart: string;
  periodEnd: string;
  options: AttendanceOptions;
}): DayRecord[] {
  const { schedule, options: opts } = params;
  const tz = opts.timezone;
  const { byDate, orphanOuts } = pairSessions(params.punches, tz);
  const holidayMap = new Map(params.holidays.map((h) => [h.date, h.type]));
  const now = DateTime.fromJSDate(opts.now ?? new Date(), { zone: tz });
  const start = DateTime.fromISO(params.periodStart, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(params.periodEnd, { zone: tz }).startOf('day');
  const sStart = parseHm(schedule.startTime);
  const sEnd = parseHm(schedule.endTime);
  const regularCap = opts.hoursPerDay * 60;

  const records: DayRecord[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    const weekday = day.weekday;
    const isRest = schedule.restDays.includes(weekday);
    const holiday = holidayMap.get(date) ?? null;
    const dayType = dayTypeFor(isRest, holiday);
    const sessions = byDate.get(date) ?? [];
    const closed = sessions.filter((s): s is { start: DateTime; end: DateTime } => s.end !== null && s.end > s.start);

    const winStart = day.set({ ...sStart, second: 0, millisecond: 0 });
    let winEnd = day.set({ ...sEnd, second: 0, millisecond: 0 });
    if (winEnd <= winStart) winEnd = winEnd.plus({ days: 1 });
    const window = Interval.fromDateTimes(winStart, winEnd);

    let inWindow = 0;
    let afterWindow = 0;
    let ndRegular = 0;
    let ndAfter = 0;
    let worked = 0;
    const nights = nightWindows(day, opts);
    for (const s of closed) {
      const iv = Interval.fromDateTimes(s.start, s.end);
      worked += iv.length('minutes');
      inWindow += overlapMinutes(iv, window);
      if (s.end > winEnd) {
        const after = Interval.fromDateTimes(s.start > winEnd ? s.start : winEnd, s.end);
        afterWindow += after.length('minutes');
        ndAfter += nights.reduce((acc, n) => acc + overlapMinutes(after, n), 0);
      }
      const reg = iv.intersection(window);
      if (reg) ndRegular += nights.reduce((acc, n) => acc + overlapMinutes(reg, n), 0);
    }

    // Unpaid break: deduct when the employee didn't punch out/in for it (single long session).
    const breakDeduction = closed.length === 1 && inWindow >= 300 ? Math.min(schedule.breakMinutes, inWindow) : 0;
    let regular = Math.max(0, inWindow - breakDeduction);
    let overtime = afterWindow >= opts.minOvertimeMinutes ? afterWindow : 0;
    if (regular > regularCap) {
      overtime += regular - regularCap;
      regular = regularCap;
    }
    if (overtime === 0) ndAfter = 0;
    const ndReg = Math.max(0, Math.min(ndRegular, regular));

    const present = closed.length > 0;
    const firstIn = sessions.length ? sessions[0].start : null;
    const lastClosed = closed.length ? closed[closed.length - 1].end : null;

    let late = 0;
    let undertime = 0;
    if (present && !isRest && firstIn) {
      const lateBy = firstIn.diff(winStart, 'minutes').minutes;
      if (lateBy > schedule.graceMinutes) late = Math.floor(lateBy);
      if (lastClosed && lastClosed < winEnd) undertime = Math.floor(winEnd.diff(lastClosed, 'minutes').minutes);
    }

    const isFuture = day.endOf('day') > now;
    const beforeHire = opts.hireDate ? date < opts.hireDate : false;
    const absent = !present && !isRest && !holiday && !isFuture && !beforeHire && sessions.length === 0;

    records.push({
      date,
      weekday,
      dayType,
      scheduled: !isRest,
      holiday,
      present,
      absent,
      firstIn: firstIn?.toISO() ?? null,
      lastOut: lastClosed?.toISO() ?? null,
      workedMinutes: Math.round(worked),
      regularMinutes: Math.round(regular),
      overtimeMinutes: Math.round(overtime),
      nightDiffMinutes: Math.round(ndReg),
      nightDiffOtMinutes: Math.round(ndAfter),
      lateMinutes: late,
      undertimeMinutes: undertime,
      // An open session only counts as a missing time-out once the shift is clearly over.
      missingOut: sessions.some((s) => s.end === null && now.diff(s.start, 'hours').hours > OPEN_SESSION_STALE_HOURS),
      missingIn: orphanOuts.has(date),
    });
  }
  return records;
}

export interface AttendanceTotals {
  scheduledDays: number;
  daysPresent: number;
  daysAbsent: number;
  lateCount: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  nightDiffMinutes: number;
  workedMinutes: number;
  missingPunches: number;
}

export function summarize(records: DayRecord[]): AttendanceTotals {
  const t: AttendanceTotals = {
    scheduledDays: 0, daysPresent: 0, daysAbsent: 0, lateCount: 0, lateMinutes: 0, undertimeMinutes: 0,
    overtimeMinutes: 0, nightDiffMinutes: 0, workedMinutes: 0, missingPunches: 0,
  };
  for (const r of records) {
    if (r.scheduled && !r.holiday) t.scheduledDays++;
    if (r.present) t.daysPresent++;
    if (r.absent) t.daysAbsent++;
    if (r.lateMinutes > 0) t.lateCount++;
    t.lateMinutes += r.lateMinutes;
    t.undertimeMinutes += r.undertimeMinutes;
    t.overtimeMinutes += r.overtimeMinutes;
    t.nightDiffMinutes += r.nightDiffMinutes + r.nightDiffOtMinutes;
    t.workedMinutes += r.workedMinutes;
    if (r.missingOut || r.missingIn) t.missingPunches++;
  }
  return t;
}
