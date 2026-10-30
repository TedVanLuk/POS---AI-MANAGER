import { describe, expect, it } from 'vitest';
import { isOnDuty, projectRoster, rosterWeek } from './roster.js';
import { monthWeeks, rankMetric, trackerTotals } from './tracker.js';
import { performanceScores } from './performance.js';

const deps = [{ name: 'Bartenders', group: 'Operational staff', dailyRate: 450 }, { name: 'DJ', group: 'Sounds/Lights staff', dailyRate: 2000 }];
const emp = (id: string, department: string, week: string[]) => ({ id, name: id, department, position: null, weekPattern: week, dailyRate: 0 });

describe('roster', () => {
  const week = rosterWeek({
    employees: [
      emp('Ara', 'Bartenders', ['D', 'D', 'D', 'O', 'D', 'D', 'D']),
      emp('Jamel', 'Bartenders', ['O', 'D', 'D', 'D', 'D', 'D', 'D']),
      emp('Tommy', 'DJ', ['10-1:30', '2-5', 'N', 'N', '3-5', '10-1', 'N']),
    ],
    entries: [{ employeeId: 'Ara', date: '2026-08-05', code: 'L' }], // Wed on leave this week
    departments: deps,
    weekStart: '2026-08-05',
  });

  it('counts duty, all-in, reception and set times; not off/leave/n.a.', () => {
    expect(['D', 'A', 'R', '10-1:30'].map(isOnDuty)).toEqual([true, true, true, true]);
    expect(['O', 'L', 'N', 'X', ''].map(isOnDuty)).toEqual([false, false, false, false, false]);
  });
  it('applies week overrides on top of the usual week', () => {
    expect(week.weekStart).toBe('2026-08-03');
    const bar = week.departments.find((d) => d.name === 'Bartenders')!;
    expect(bar.totals).toEqual([1, 2, 1, 1, 2, 2, 2]);
    expect(bar.rows[0].cells[2]).toMatchObject({ code: 'L', override: true });
  });
  it('estimates payroll as person-days × department amount', () => {
    expect(week.departments.find((d) => d.name === 'Bartenders')!.estPayroll).toBe(11 * 450);
    expect(week.departments.find((d) => d.name === 'DJ')!.estPayroll).toBe(4 * 2000);
    expect(week.estPayroll).toBe(4950 + 8000);
    expect(week.groups.map((g) => g.group)).toEqual(['Operational staff', 'Sounds/Lights staff']);
  });
  it('projects savings and extra spend', () => {
    const less = projectRoster(week, { Bartenders: [1, 1, 1, 1, 1, 1, 1] });
    expect(less.periods.week.difference).toBe(-4 * 450);
    expect(less.periods.year.difference).toBe(-4 * 450 * 52);
    const more = projectRoster(week, { DJ: [2, 1, 0, 0, 1, 1, 0] });
    expect(more.periods.week.difference).toBe(2000);
  });
});

describe('servers tracker', () => {
  it('splits a month into Monday–Sunday weeks clipped to the month', () => {
    expect(monthWeeks('2026-10').map((w) => [w.start, w.end])).toEqual([
      ['2026-10-01', '2026-10-04'], ['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-18'], ['2026-10-19', '2026-10-25'], ['2026-10-26', '2026-10-31'],
    ]);
  });
  it('totals and ranks a week', () => {
    const people = [{ employeeId: 'a', name: 'Kevin', position: 'Server' }, { employeeId: 'b', name: 'Sioco', position: 'Server' }, { employeeId: 'c', name: 'Mia', position: 'Server' }];
    const stats = [
      { employeeId: 'a', date: '2026-10-01', orders: 21, salesComms: 0, lds: 0, po: 0 },
      { employeeId: 'a', date: '2026-10-03', orders: 40, salesComms: 0, lds: 2, po: 0 },
      { employeeId: 'b', date: '2026-10-04', orders: 51, salesComms: 1, lds: 0, po: 0 },
      { employeeId: 'b', date: '2026-10-05', orders: 99, salesComms: 0, lds: 0, po: 0 }, // next week
    ];
    const totals = trackerTotals(people, stats, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(totals.map((t) => t.orders)).toEqual([61, 51, 0]);
    const r = rankMetric(totals, 'orders');
    expect(r.top.map((x) => x.name)).toEqual(['Kevin', 'Sioco']);
    expect(r.lowest[0].name).toBe('Mia');
  });
});

describe('performance scores', () => {
  const att = { scheduledDays: 100, daysPresent: 98, daysAbsent: 2, lateCount: 6, lateMinutes: 85, undertimeMinutes: 0, overtimeMinutes: 0, nightDiffMinutes: 0, workedMinutes: 0, missingPunches: 0 };
  it('weights attendance, punctuality, sales, discipline and teamwork', () => {
    const s = performanceScores({ attendance: att, leaveDays: 0, approvedPenalties: 0, penaltyAmount: 0, warnings: 1, compliments: 3, sales: { orders: 400, salesComms: 5, lds: 20, po: 0, daysWithData: 90 }, teamSalesIndex: [4, 5, 6], ratings: { teamwork: 5, communication: 4.5, reliability: 5, professionalism: 4.5, leadership: 4.5 } });
    expect(s.components.attendance).toBe(98);
    expect(s.components.punctuality).toBeCloseTo(93, 0);
    expect(s.components.discipline).toBe(90);
    expect(s.components.teamwork).toBe(94);
    expect(s.overall).toBeGreaterThan(85);
    expect(s.stars).toBeGreaterThanOrEqual(4.5);
  });
  it('uses review ratings for sales when there is no tracker data', () => {
    const s = performanceScores({ attendance: att, leaveDays: 0, approvedPenalties: 0, penaltyAmount: 0, warnings: 0, compliments: 0, sales: null, teamSalesIndex: [], ratings: { serviceQuality: 4, productKnowledge: 4, customerOrientation: 4 } });
    expect(s.components.sales).toBe(80);
  });
});
