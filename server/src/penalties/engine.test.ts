import { describe, expect, it } from 'vitest';
import type { DayRecord } from '../attendance/engine.js';
import { evaluatePenalties } from './engine.js';

const d = (date: string, o: Partial<DayRecord>): DayRecord => ({
  date, weekday: 1, dayType: 'ordinary', scheduled: true, holiday: null, present: true, absent: false, firstIn: null,
  lastOut: null, workedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, nightDiffMinutes: 0, nightDiffOtMinutes: 0,
  lateMinutes: 0, undertimeMinutes: 0, missingOut: false, missingIn: false, ...o,
});

describe('evaluatePenalties', () => {
  const days = [d('2026-10-01', { lateMinutes: 10 }), d('2026-10-02', { lateMinutes: 45 }), d('2026-10-03', { lateMinutes: 3 }), d('2026-10-05', { absent: true, present: false }), d('2026-10-06', { missingOut: true })];
  const result = evaluatePenalties([
    { id: 'tier', name: 'Late policy', config: { kind: 'late_tiered', tiers: [{ minMinutes: 1, maxMinutes: 5, amount: 0 }, { minMinutes: 6, maxMinutes: 30, amount: 50 }, { minMinutes: 31, maxMinutes: null, amount: 150 }] } },
    { id: 'freq', name: 'Habitual tardiness', config: { kind: 'late_frequency', threshold: 3, amount: 300 } },
    { id: 'abs', name: 'AWOL', config: { kind: 'absence', amount: 200 } },
    { id: 'miss', name: 'No time-out', config: { kind: 'missing_timeout', amount: 25 } },
  ], days, '2026-10-01');

  it('applies late tiers (zero-amount tier ignored)', () => {
    expect(result.filter((r) => r.ruleId === 'tier').map((r) => [r.date, r.amount])).toEqual([['2026-10-01', 50], ['2026-10-02', 150]]);
  });
  it('adds a frequency penalty once per window', () => {
    expect(result.filter((r) => r.ruleId === 'freq')).toEqual([expect.objectContaining({ amount: 300, sourceKey: 'latefreq:2026-10-01', date: '2026-10-03' })]);
  });
  it('handles absences and missing time-outs', () => {
    expect(result.find((r) => r.ruleId === 'abs')?.date).toBe('2026-10-05');
    expect(result.find((r) => r.ruleId === 'miss')?.amount).toBe(25);
  });
});
