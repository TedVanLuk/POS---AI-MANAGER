import { describe, expect, it } from 'vitest';
import { achievement, analyse, operationalFor, type ReviewInput } from './sevenstep.js';

const base: ReviewInput = {
  tasksAssigned: 10, tasksCompleted: 10, quantityScore: null, qualityScore: 'good',
  scheduledHours: 8, productiveHours: 7.5, operational: [{ name: 'Orders', plan: 20, fact: 22 }],
  revenuePlan: 10000, revenueFact: 11000, cost: 440,
};

describe('7-step management system', () => {
  it('compares plan vs fact both ways', () => {
    expect(achievement({ plan: 20, fact: 22 })).toBeCloseTo(1.1);
    expect(achievement({ plan: 5, fact: 10, lowerIsBetter: true })).toBe(0.5);
    expect(achievement({ plan: null, fact: 3 })).toBeNull();
  });

  it('places good results + hard work in category 1 and coasting talent in 2', () => {
    const a = analyse(base);
    expect([a.quantity, a.completion, a.hoursRatio, a.resultsGood, a.effort, a.suggestedCategory]).toEqual(['excellent', 100, 93.8, true, 'hard', 1]);
    expect(a.margin).toBe(10560);
    expect(analyse({ ...base, tasksCompleted: 5, productiveHours: 5 }).suggestedCategory).toBe(2);
  });

  it('separates poor results by effort and by progress over time', () => {
    const poor = { ...base, qualityScore: 'bad' as const, operational: [{ name: 'Orders', plan: 20, fact: 10 }], revenueFact: 6000 };
    expect(analyse(poor).suggestedCategory).toBe(3);
    expect(analyse({ ...poor, productiveHours: 4, tasksCompleted: 4 }).suggestedCategory).toBe(5);
    const stuck = [3, 3, 3].map((c, i) => ({ date: `2026-11-0${i + 1}`, category: c, resultsIndex: 0.55 }));
    const a = analyse(poor, stuck);
    expect([a.suggestedImproving, a.suggestedCategory]).toEqual([false, 4]);
    expect(analyse(poor, stuck.map((h) => ({ ...h, resultsIndex: 0.3 }))).suggestedCategory).toBe(3);
    expect(analyse({ ...poor, improving: true }, stuck).suggestedCategory).toBe(3);
  });

  it('fills server plans from the tracker', () => {
    const m = operationalFor('Servers', { today: { orders: 15, lds: 3, salesComms: 1 }, history: [{ orders: 10, lds: 2, salesComms: 0 }, { orders: 20, lds: 4, salesComms: 2 }] });
    expect(m.slice(0, 3).map((x) => [x.plan, x.fact])).toEqual([[15, 15], [3, 3], [1, 1]]);
    expect(operationalFor('DJ').map((x) => x.name)).toContain('Table turn time');
  });
});
