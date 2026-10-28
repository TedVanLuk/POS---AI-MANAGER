import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { buildDailyRecords, summarize, type PunchInput } from './engine.js';

const TZ = 'Asia/Manila';
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const p = (type: 'in' | 'out', iso: string): PunchInput => ({ type, at: at(iso) });
const options = { timezone: TZ, hoursPerDay: 8, nightDiffStart: '22:00', nightDiffEnd: '06:00', minOvertimeMinutes: 30, now: at('2026-10-31T23:00') };
const day = { startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] };

describe('buildDailyRecords', () => {
  const records = buildDailyRecords({
    punches: [
      p('in', '2026-10-05T09:03'), p('out', '2026-10-05T18:00'), // within grace
      p('in', '2026-10-06T09:20'), p('out', '2026-10-06T20:00'), // late 20, OT 120
      // 10-07 absent
      p('in', '2026-10-08T09:00'), p('out', '2026-10-08T16:00'), // undertime 120
      p('in', '2026-10-09T09:00'), // missing out
      p('in', '2026-10-11T10:00'), p('out', '2026-10-11T15:00'), // Sunday rest day work
    ],
    schedule: day,
    holidays: [],
    periodStart: '2026-10-05',
    periodEnd: '2026-10-11',
    options,
  });
  const byDate = Object.fromEntries(records.map((r) => [r.date, r]));

  it('applies the grace period', () => {
    expect(byDate['2026-10-05']).toMatchObject({ present: true, lateMinutes: 0, regularMinutes: 477, overtimeMinutes: 0 });
  });
  it('counts late minutes from schedule start and overtime after end', () => {
    expect(byDate['2026-10-06']).toMatchObject({ lateMinutes: 20, regularMinutes: 460, overtimeMinutes: 120 });
  });
  it('marks scheduled days without punches absent', () => {
    expect(byDate['2026-10-07']).toMatchObject({ present: false, absent: true });
  });
  it('computes undertime', () => {
    expect(byDate['2026-10-08']).toMatchObject({ undertimeMinutes: 120, regularMinutes: 360 });
  });
  it('flags missing time-out without marking absent', () => {
    expect(byDate['2026-10-09']).toMatchObject({ present: false, absent: false, missingOut: true });
  });
  it('treats Saturday as a work day and Sunday as rest day', () => {
    expect(byDate['2026-10-10']).toMatchObject({ absent: true, dayType: 'ordinary' });
    expect(byDate['2026-10-11']).toMatchObject({ dayType: 'rest', present: true, lateMinutes: 0, regularMinutes: 240 });
  });
  it('summarizes the week', () => {
    expect(summarize(records)).toMatchObject({ daysPresent: 4, daysAbsent: 2, lateCount: 1, lateMinutes: 20, overtimeMinutes: 120, missingPunches: 1 });
  });
});

describe('night shift', () => {
  it('assigns overnight work to the start date and computes night differential', () => {
    const [r] = buildDailyRecords({
      punches: [p('in', '2026-10-05T22:00'), p('out', '2026-10-06T07:00')],
      schedule: { startTime: '22:00', endTime: '07:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] },
      holidays: [],
      periodStart: '2026-10-05',
      periodEnd: '2026-10-05',
      options,
    });
    expect(r).toMatchObject({ present: true, regularMinutes: 480, nightDiffMinutes: 480, lateMinutes: 0, undertimeMinutes: 0 });
  });
  it('splits night differential between regular and overtime hours', () => {
    const [r] = buildDailyRecords({
      punches: [p('in', '2026-10-05T14:00'), p('out', '2026-10-06T01:00')],
      schedule: { startTime: '14:00', endTime: '23:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] },
      holidays: [],
      periodStart: '2026-10-05',
      periodEnd: '2026-10-05',
      options,
    });
    expect(r).toMatchObject({ regularMinutes: 480, overtimeMinutes: 120, nightDiffMinutes: 60, nightDiffOtMinutes: 120 });
  });
});

describe('open sessions', () => {
  it('does not flag an employee who is still on shift', () => {
    const [r] = buildDailyRecords({
      punches: [p('in', '2026-10-05T09:00')],
      schedule: day, holidays: [], periodStart: '2026-10-05', periodEnd: '2026-10-05',
      options: { ...options, now: at('2026-10-05T15:00') },
    });
    expect(r).toMatchObject({ missingOut: false, absent: false, firstIn: '2026-10-05T09:00:00.000+08:00' });
  });
});

describe('holidays', () => {
  it('classifies regular holiday and does not mark it absent', () => {
    const records = buildDailyRecords({
      punches: [],
      schedule: day,
      holidays: [{ date: '2026-11-30', type: 'regular' }],
      periodStart: '2026-11-30',
      periodEnd: '2026-11-30',
      options: { ...options, now: at('2026-12-31T00:00') },
    });
    expect(records[0]).toMatchObject({ dayType: 'regular_holiday', absent: false });
  });
});
