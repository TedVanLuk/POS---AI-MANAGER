import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { PH_2025 } from '../payroll/statutory-ph.js';
import { dailyCost, projectHeadcount, weeklyPlan, type PlanEmployee } from './workforce.js';

const s = DEFAULT_SETTINGS.payroll;
const mk = (id: string, department: string, rate: number, restDays = [7]): PlanEmployee => ({
  id, firstName: id, lastName: 'X', position: 'Staff', department, payType: 'daily', rate, allowances: [], exemptions: {},
  schedule: { name: 'Day', startTime: '09:00', endTime: '18:00', restDays },
});

describe('dailyCost', () => {
  it('adds employer statutory share spread over working days', () => {
    // ₱700/day → monthly 18,258.33 → SSS ER 1,850 + EC 30, PhilHealth ER 456.46, Pag-IBIG ER 200 = 2,536.46/month
    const c = dailyCost({ payType: 'daily', rate: 700, allowances: [], exemptions: {} }, s, PH_2025);
    expect(c.wage).toBe(700);
    expect(c.employer).toBe(97.24); // 2,536.46 × 12 / 313
    expect(c.total).toBe(797.24);
  });
});

describe('weeklyPlan + projectHeadcount', () => {
  // Week of Mon 2026-11-23; Mon 30 Nov is outside, so add a regular holiday on Wed 25 Nov for the test.
  const plan = weeklyPlan([mk('a', 'Service', 700), mk('b', 'Service', 700, [3]), mk('c', 'Kitchen', 800)], '2026-11-25', [{ date: '2026-11-25', type: 'regular' }], s, PH_2025);

  it('starts on Monday and counts people per department per day', () => {
    expect(plan.weekStart).toBe('2026-11-23');
    const service = plan.byDepartment.find((d) => d.department === 'Service')!;
    expect(service.perDay.map((d) => d.count)).toEqual([2, 2, 1, 2, 2, 2, 1]); // b rests Wed, a rests Sun
  });

  it('charges holiday premium on working holidays', () => {
    const a = plan.rows.find((r) => r.employeeId === 'a')!;
    expect(a.cells[2].cost).toBe(1497.24); // 700 × 200% + 97.24 employer share
    expect(a.cells[6].cost).toBe(0); // rest day
  });

  it('projects savings when head-count drops and extra cost when it rises', () => {
    const service = plan.byDepartment.find((d) => d.department === 'Service')!;
    const less = projectHeadcount(plan, { Service: service.perDay.map((d) => d.count - 1) });
    expect(less.periods.week.difference).toBeLessThan(0);
    const more = projectHeadcount(plan, { Kitchen: [2, 2, 2, 2, 2, 2, 1] });
    // +1 kitchen person Mon–Sat; Wed is a regular holiday (200% wage)
    expect(more.periods.week.difference).toBeGreaterThan(0);
    const same = projectHeadcount(plan, {});
    expect(same.periods.year.difference).toBe(0);
    expect(more.periods.year.scenario).toBeCloseTo(more.periods.week.scenario * 52, 1);
  });
});
