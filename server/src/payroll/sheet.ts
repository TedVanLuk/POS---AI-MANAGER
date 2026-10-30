import { round2 } from '../lib/money.js';

/**
 * Weekly payroll sheet in the MDC format: one row per person per role, grouped into
 * sheets (Admin/Cashiers/Bouncers, Servers, …) and department sections.
 *   Gross   = days worked × daily rate (or a fixed amount, e.g. maintenance)
 *   OT      = OT hours × (daily rate ÷ 8) × 125%
 *   ND      = ND hours × (daily rate ÷ 8) × 10%   (ND hours default to days × 7)
 *   Net pay = gross + OT + ND − advances/penalties
 * Each amount is rounded to the centavo per row, so the totals are what is paid out in cash.
 */
export const SHEET_RULES = { hoursPerDay: 8, overtimeRate: 1.25, nightDiffRate: 0.1, defaultNdHoursPerDay: 7 } as const;

export interface RowEdit { at: string; by: string; byName: string; reason: string | null; changes: { field: string; from: unknown; to: unknown }[] }
export interface SheetRow {
  id: string;
  employeeId: string | null;
  name: string;
  sheet: string;
  section: string;
  days: number;
  dailyRate: number;
  /** Flat pay for the period instead of days × rate (e.g. maintenance). */
  fixedPay: number | null;
  otHours: number;
  ndHours: number;
  /** ND hours per worked day, used to update ND hours when days change. 0 = no night differential. */
  ndPerDay: number;
  deductions: number;
  deductionNote: string | null;
  remarks: string | null;
  paid: boolean;
  paidAt: string | null;
  paidBy: string | null;
  history: RowEdit[];
}
export type ComputedRow = SheetRow & { gross: number; hourly: number; otAmount: number; ndAmount: number; net: number };

export function computeRow(r: SheetRow): ComputedRow {
  const hourly = r.dailyRate / SHEET_RULES.hoursPerDay;
  const gross = round2(r.fixedPay ?? r.days * r.dailyRate);
  const otAmount = round2(r.otHours * hourly * SHEET_RULES.overtimeRate);
  const ndAmount = round2(r.ndHours * hourly * SHEET_RULES.nightDiffRate);
  return { ...r, hourly, gross, otAmount, ndAmount, net: round2(gross + otAmount + ndAmount - r.deductions) };
}

const ZERO = () => ({ days: 0, gross: 0, otHours: 0, otAmount: 0, ndHours: 0, ndAmount: 0, deductions: 0, net: 0, paid: 0, balance: 0, people: 0 });
type Totals = ReturnType<typeof ZERO>;
function add(t: Totals, r: ComputedRow) {
  t.days += r.days; t.gross += r.gross; t.otHours += r.otHours; t.otAmount += r.otAmount; t.ndHours += r.ndHours; t.ndAmount += r.ndAmount;
  t.deductions += r.deductions; t.net += r.net; t.people += 1;
  if (r.paid) t.paid += r.net; else t.balance += r.net;
}
const tidy = (t: Totals): Totals => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === 'people' ? v : round2(v)])) as Totals;

/** Things worth a second look before paying out. */
export function rowWarnings(r: ComputedRow, periodDays: number): string[] {
  const w: string[] = [];
  if (r.days > periodDays) w.push(`${r.days} days worked in a ${periodDays}-day period`);
  if (r.fixedPay === null && r.days > 0 && r.dailyRate <= 0) w.push('No daily rate');
  if (r.ndPerDay > 0 && r.fixedPay === null && Math.abs(r.ndHours - r.days * r.ndPerDay) > 0.01) w.push(`ND hours ${r.ndHours} ≠ ${r.days} days × ${r.ndPerDay} h`);
  if (r.net < 0) w.push('Deductions are more than the pay');
  return w;
}

/** Sheets → sections → rows with totals, plus the summary page (amount, paid, balance, cash). */
export function computeSheet(rows: SheetRow[], opts: { cashReceived: number; periodDays: number; sheetOrder?: string[] }) {
  const computed = rows.map(computeRow);
  const names = [...new Set([...(opts.sheetOrder ?? []), ...computed.map((r) => r.sheet)])].filter((n) => computed.some((r) => r.sheet === n));
  const sheets = names.map((name) => {
    const mine = computed.filter((r) => r.sheet === name);
    const totals = ZERO();
    const sections = [...new Set(mine.map((r) => r.section))].map((section) => ({
      name: section,
      rows: mine.filter((r) => r.section === section).map((r) => { add(totals, r); return { ...r, warnings: rowWarnings(r, opts.periodDays) }; }),
    }));
    return { name, sections, totals: tidy(totals) };
  });
  const all = ZERO();
  computed.forEach((r) => add(all, r));
  const totals = tidy(all);
  const remaining = round2(opts.cashReceived - totals.paid);
  return {
    sheets,
    totals,
    summary: {
      rows: sheets.map((s) => ({ sheet: s.name, amount: s.totals.net, paid: s.totals.paid, balance: s.totals.balance })),
      amount: totals.net, paid: totals.paid, balance: totals.balance,
      cashReceived: round2(opts.cashReceived), remaining,
      /** Unpaid salaries not covered by the cash still on hand. */
      toFund: round2(totals.balance - remaining),
    },
    warnings: computed.reduce((a, r) => a + rowWarnings(r, opts.periodDays).length, 0),
  };
}
export type ComputedSheet = ReturnType<typeof computeSheet>;

export interface SheetDepartment { name: string; paySheet?: string | null; nightDiffHours?: number | null }
export interface SheetSource { id: string; name: string; department: string | null; dailyRate: number; days: number; otMinutes: number; penalties: number; penaltyNote: string | null }

/** Fresh rows for a period: one per employee whose department is on a payroll sheet. */
export function buildSheetRows(people: SheetSource[], departments: SheetDepartment[], sheetOrder: string[], newId: () => string) {
  const deptIndex = new Map(departments.map((d, i) => [d.name, i]));
  const sheetIndex = new Map(sheetOrder.map((s, i) => [s, i]));
  const rows: SheetRow[] = [];
  const excluded: string[] = [];
  for (const p of people) {
    const dep = departments.find((d) => d.name === p.department);
    if (!dep?.paySheet) { excluded.push(p.name); continue; }
    const ndPerDay = dep.nightDiffHours ?? SHEET_RULES.defaultNdHoursPerDay;
    rows.push({
      id: newId(), employeeId: p.id, name: p.name, sheet: dep.paySheet, section: dep.name,
      days: p.days, dailyRate: round2(p.dailyRate), fixedPay: null,
      otHours: Math.floor(p.otMinutes / 60), ndHours: round2(p.days * ndPerDay), ndPerDay,
      deductions: round2(p.penalties), deductionNote: p.penaltyNote, remarks: null,
      paid: false, paidAt: null, paidBy: null, history: [],
    });
  }
  const rank = (r: SheetRow) => [sheetIndex.get(r.sheet) ?? 999, deptIndex.get(r.section) ?? 999] as const;
  rows.sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
  return { rows, excluded };
}

export const EDITABLE_FIELDS = ['employeeId', 'name', 'sheet', 'section', 'days', 'dailyRate', 'fixedPay', 'otHours', 'ndHours', 'ndPerDay', 'deductions', 'deductionNote', 'remarks', 'paid'] as const;
export type RowChange = Partial<Pick<SheetRow, typeof EDITABLE_FIELDS[number]>> & { id?: string };

/**
 * Apply edits from the sheet form. Every changed field is kept in the row's history with who,
 * when and why. Rows without an id are added; ids in `remove` are deleted.
 * A final sheet only accepts paid/remarks changes.
 */
export function applyRowChanges(rows: SheetRow[], body: { changes?: RowChange[]; remove?: string[] }, actor: { id: string; name: string }, opts: { reason: string | null; now: string; newId: () => string; locked: boolean }) {
  const next = rows.map((r) => ({ ...r }));
  const removed = new Set(body.remove ?? []);
  if (opts.locked && removed.size) throw new Error('This payroll is final — reopen it to remove rows');
  for (const c of body.changes ?? []) {
    if (!c.id) {
      if (opts.locked) throw new Error('This payroll is final — reopen it to add rows');
      if (!c.name?.trim() || !c.sheet || !c.section) throw new Error('A new row needs a name, sheet and section');
      next.push({
        id: opts.newId(), employeeId: c.employeeId ?? null, name: c.name.trim(), sheet: c.sheet, section: c.section,
        days: c.days ?? 0, dailyRate: c.dailyRate ?? 0, fixedPay: c.fixedPay ?? null, otHours: c.otHours ?? 0,
        ndPerDay: c.ndPerDay ?? SHEET_RULES.defaultNdHoursPerDay, ndHours: c.ndHours ?? round2((c.days ?? 0) * (c.ndPerDay ?? SHEET_RULES.defaultNdHoursPerDay)),
        deductions: c.deductions ?? 0, deductionNote: c.deductionNote ?? null, remarks: c.remarks ?? null,
        paid: !!c.paid, paidAt: c.paid ? opts.now : null, paidBy: c.paid ? actor.name : null,
        history: [{ at: opts.now, by: actor.id, byName: actor.name, reason: opts.reason, changes: [{ field: 'row', from: null, to: 'added' }] }],
      });
      continue;
    }
    const row = next.find((r) => r.id === c.id);
    if (!row) throw new Error('Unknown row');
    const changes: RowEdit['changes'] = [];
    for (const f of EDITABLE_FIELDS) {
      if (!(f in c) || c[f] === undefined || c[f] === row[f]) continue;
      if (opts.locked && f !== 'paid' && f !== 'remarks') throw new Error('This payroll is final — reopen it to change amounts');
      changes.push({ field: f, from: row[f], to: c[f] });
      (row as Record<string, unknown>)[f] = c[f];
    }
    if (!changes.length) continue;
    if ('paid' in c && changes.some((x) => x.field === 'paid')) { row.paidAt = row.paid ? opts.now : null; row.paidBy = row.paid ? actor.name : null; }
    row.history = [...row.history, { at: opts.now, by: actor.id, byName: actor.name, reason: opts.reason, changes }];
  }
  return next.filter((r) => !removed.has(r.id));
}

/** "Oct. 5-11" style period label used on the sheet header. */
export function periodLabel(start: string, end: string) {
  const M = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  const [, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return sm === em ? `${M[sm - 1]} ${sd}-${ed}, ${ey}` : `${M[sm - 1]} ${sd} - ${M[em - 1]} ${ed}, ${ey}`;
}

export type PaperRow = [sheet: string, section: string, name: string, days: number, dailyRate: number, fixedPay: number | null, otHours: number, ndHours: number, ndPerDay: number, deductions: number, paid: boolean, remarks: string | null];

/** Rows typed in from a paper/Excel sheet (used for the imported Oct. 5-11 payroll). */
export function rowsFromPaper(rows: PaperRow[], newId: () => string, link: (name: string, section: string) => string | null = () => null): SheetRow[] {
  return rows.map(([sheet, section, name, days, dailyRate, fixedPay, otHours, ndHours, ndPerDay, deductions, paid, remarks]) => ({
    id: newId(), employeeId: link(name, section), name, sheet, section, days, dailyRate, fixedPay, otHours, ndHours, ndPerDay,
    deductions, deductionNote: null, remarks, paid, paidAt: null, paidBy: null, history: [],
  }));
}

/** Match a full name from a paper payroll ("Jessa Corpin") to a staff record ("Jessa C"), when unambiguous. */
export function nameLinker(staff: { id: string; name: string; department: string | null }[]) {
  const toks = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return (name: string, section: string) => {
    const t = toks(name);
    if (!t.length) return null;
    const sameDept = (d: string | null) => d === section || (section === 'Servers' && d === 'Supervisors');
    let c = staff.filter((s) => toks(s.name)[0] === t[0] && sameDept(s.department));
    if (c.length > 1) c = c.filter((s) => { const st = toks(s.name); return st.length > 1 && t.length > 1 && t[t.length - 1].startsWith(st[1]); });
    return c.length === 1 ? c[0].id : null;
  };
}
