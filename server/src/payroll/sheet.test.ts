import { describe, expect, it } from 'vitest';
import { MDC_PAYROLL_OCT_5_11 as P } from '../db/mdc-data.js';
import { applyRowChanges, buildSheetRows, computeRow, computeSheet, periodLabel, rowsFromPaper } from './sheet.js';

let n = 0;
const newId = () => `r${++n}`;

describe('weekly payroll sheet (MDC format)', () => {
  it('computes a row like the paper sheet', () => {
    const r = computeRow({ ...rowsFromPaper([['Servers', 'Servers', 'Kevin Ang', 5, 400, null, 0, 35, 7, 90, false, null]], newId)[0] });
    expect([r.gross, r.ndAmount, r.net]).toEqual([2000, 175, 2085]);
    const ot = computeRow(rowsFromPaper([['HK', 'Housekeeping', 'Patrick Francisco', 6, 400, null, 4, 42, 7, 0, true, null]], newId)[0]);
    expect([ot.otAmount, ot.ndAmount, ot.net]).toEqual([250, 210, 2860]);
    expect(computeRow(rowsFromPaper([['B', 'Cashiers', 'Marynoll Padua', 5, 450, null, 0, 35, 7, 0, true, null]], newId)[0]).net).toBe(2446.88);
    expect(computeRow(rowsFromPaper([['B', 'Maintenance', 'Edwin Dayrit', 0, 0, 4500, 0, 0, 0, 0, false, null]], newId)[0]).net).toBe(4500);
  });

  it('reproduces the Oct. 5-11 payroll', () => {
    const s = computeSheet(rowsFromPaper(P.rows, newId), { cashReceived: P.cashReceived, periodDays: 7, sheetOrder: P.sheets });
    expect(s.sheets.map((x) => x.name)).toEqual(P.sheets);
    const by = Object.fromEntries(s.sheets.map((x) => [x.name, x.totals]));
    // Gross and deductions match the paper exactly. Net differs from the Excel totals only by
    // centavos, because Excel adds up unrounded night-diff amounts (e.g. 196.875).
    expect(by['Admin, Cashiers, Bouncers'].gross).toBe(42200);
    expect(by['Admin, Cashiers, Bouncers'].net).toBe(43571.27); // paper: 43,571.25
    expect(by.Servers.net).toBe(73982.25); // paper summary: 73,982.25 (sheet total 72,382.25 left out Arnold's gross)
    expect(by.Servers.paid).toBe(45286.25);
    expect(by.Servers.balance).toBe(28696);
    expect(by['HK, Recep, Promoters']).toMatchObject({ gross: 28050, otAmount: 250, ndAmount: 1315.63, deductions: 1500, net: 28115.63 });
    expect(by['Bartenders, Checkers, Maintenance'].gross).toBe(20100);
    expect(by.Kitchen).toMatchObject({ gross: 11400, ndHours: 182, ndAmount: 997.5, net: 12397.5 });
    expect(s.summary.amount).toBe(177521.67); // paper: 177,521.63
    expect(s.summary.remaining).toBe(round(136554 - s.summary.paid));
    expect(s.warnings).toBeGreaterThan(0); // Ma. Adelyn Antoc: 8 days in a 7-day week
  });

  it('records who changed what and why, and locks a final sheet', () => {
    const rows = rowsFromPaper(P.rows.slice(5, 7), newId);
    const next = applyRowChanges(rows, { changes: [{ id: rows[1].id, days: 3, ndHours: 21 }] }, { id: 'u1', name: 'Daniel' }, { reason: 'Absent Sunday', now: '2026-10-12T10:00:00Z', newId, locked: false });
    expect(next[1].history.at(-1)).toMatchObject({ byName: 'Daniel', reason: 'Absent Sunday', changes: [{ field: 'days', from: 4, to: 3 }, { field: 'ndHours', from: 28, to: 21 }] });
    expect(() => applyRowChanges(next, { changes: [{ id: rows[1].id, days: 5 }] }, { id: 'u1', name: 'Daniel' }, { reason: null, now: '', newId, locked: true })).toThrow(/final/);
    const paid = applyRowChanges(next, { changes: [{ id: rows[1].id, paid: true }] }, { id: 'u1', name: 'Daniel' }, { reason: null, now: 'T', newId, locked: true });
    expect(paid[1]).toMatchObject({ paid: true, paidBy: 'Daniel', paidAt: 'T' });
  });

  it('builds rows from attendance by payroll sheet and department', () => {
    const { rows, excluded } = buildSheetRows([
      { id: 'a', name: 'Kevin', department: 'Servers', dailyRate: 400, days: 5, otMinutes: 130, penalties: 90, penaltyNote: 'Late Oct 6' },
      { id: 'b', name: 'Fremie', department: 'Admin', dailyRate: 1000, days: 5, otMinutes: 0, penalties: 0, penaltyNote: null },
      { id: 'c', name: 'DJ Leo', department: 'DJ', dailyRate: 2000, days: 3, otMinutes: 0, penalties: 0, penaltyNote: null },
    ], [{ name: 'Admin', paySheet: 'A', nightDiffHours: 0 }, { name: 'Servers', paySheet: 'S' }, { name: 'DJ' }], ['A', 'S'], newId);
    expect(rows.map((r) => [r.name, r.ndHours, r.otHours, r.deductions])).toEqual([['Fremie', 0, 0, 0], ['Kevin', 35, 2, 90]]);
    expect(excluded).toEqual(['DJ Leo']);
    expect(periodLabel('2026-10-05', '2026-10-11')).toBe('Oct. 5-11, 2026');
  });
});
const round = (x: number) => Math.round(x * 100) / 100;
