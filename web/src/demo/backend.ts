/**
 * In-browser demo backend. Implements the same HTTP API as the Fastify server over an
 * in-memory store (saved to this browser), using the server's own pure engines:
 * attendance, PH payroll, penalties and fighter-card stats. Used by the artifact demo build.
 */
import { DateTime } from 'luxon';
import { buildDailyRecords, summarize, type DayRecord, type ScheduleInput } from '../../../server/src/attendance/engine';
import { computePayslip, type LineOverride, type PayLine } from '../../../server/src/payroll/engine';
import { evaluatePenalties } from '../../../server/src/penalties/engine';
import { computeCard, median } from '../../../server/src/stats/engine';
import { currentCutoff, dailyTrend, overtimeLeaders } from '../../../server/src/stats/dashboard';
import { weeklyPlan } from '../../../server/src/stats/workforce';
import { tablesFor } from '../../../server/src/payroll/statutory-ph';
import { DEFAULT_SETTINGS, withDefaults } from '../../../server/src/settings';
import type { PenaltyRuleConfig, TenantSettings } from '../../../server/src/db/schema';
import { ApiError } from '../api';

// ---------------------------------------------------------------- store types
type Role = 'owner' | 'admin' | 'manager' | 'employee';
interface Employee {
  id: string; employeeNo: string; firstName: string; lastName: string; position: string | null; department: string | null;
  branchId: string | null; scheduleId: string | null; payType: 'monthly' | 'daily' | 'hourly'; rate: number;
  allowances: { code: string; label: string; amount: number; taxable?: boolean }[];
  exemptions: { withholdingTax?: boolean; sss?: boolean; philhealth?: boolean; pagibig?: boolean };
  tin: string | null; sssNo: string | null; philhealthNo: string | null; pagibigNo: string | null;
  hireDate: string | null; active: boolean; pin: string | null; biometricConsentAt: string | null; photoUrl?: string | null; createdAt: string;
}
interface User { id: string; email: string; name: string; password: string; role: Role; employeeId: string | null }
interface Device { id: string; name: string; driver: string; active: boolean; lastSeenAt: string | null; createdAt: string; token: string; branchId: string | null }
interface Template { id: string; employeeId: string; finger: string; format: string; template: string; quality: number | null; createdAt: string }
interface Punch { id: string; employeeId: string; deviceId: string | null; type: 'in' | 'out'; punchedAt: string; method: 'fingerprint' | 'pin' | 'manual'; matchScore: number | null; clientUuid: string | null; voided: boolean; createdBy: string | null; reason: string | null }
interface Holiday { id: string; date: string; name: string; type: 'regular' | 'special_non_working' | 'special_working' }
interface Schedule { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; graceMinutes: number; restDays: number[] }
interface Run { id: string; periodStart: string; periodEnd: string; payDate: string | null; frequency: 'semi_monthly' | 'monthly' | 'weekly'; cutoff: number; status: 'draft' | 'review' | 'approved' | 'paid' | 'void'; createdBy: string | null; approvedBy: string | null; approvedAt: string | null; computedAt: string | null; branchId: string | null; notes: string | null; createdAt: string }
interface Payslip { id: string; runId: string; employeeId: string; gross: number; totalDeductions: number; net: number; summary: Record<string, unknown> }
interface Line extends PayLine { id: string; payslipId: string; updatedBy: string | null; updatedAt: string | null; editReason: string | null }
interface Rule { id: string; name: string; config: PenaltyRuleConfig; active: boolean; autoApprove: boolean; createdAt: string }
interface Penalty { id: string; employeeId: string; ruleId: string | null; date: string; kind: string; minutes: number | null; amount: number; reason: string; status: 'pending' | 'approved' | 'waived'; sourceKey: string | null; issuedBy: string | null; decidedBy: string | null; decidedAt: string | null; decisionReason: string | null; payrollRunId: string | null; createdAt: string }
interface Slip { id: string; branchId: string | null; serverEmployeeId: string; serialNo: string; tableNo: string | null; openedAt: string; servedAt: string | null; closedAt: string | null; amount: number; itemsCount: number; status: 'open' | 'closed' | 'void'; voidReason: string | null }
interface Note { id: string; employeeId: string; authorId: string; category: string; title: string; body: string; rating: number; visibleToEmployee: boolean; createdAt: string }
interface Audit { id: string; actorUserId: string | null; actorDeviceId: string | null; entity: string; entityId: string | null; action: string; before: unknown; after: unknown; reason: string | null; createdAt: string }

interface Store {
  version: number;
  tenant: { id: string; name: string; timezone: string; currency: string; settings: TenantSettings };
  branches: { id: string; name: string; address: string | null }[];
  schedules: Schedule[]; employees: Employee[]; users: User[]; devices: Device[]; templates: Template[];
  punches: Punch[]; holidays: Holiday[]; runs: Run[]; payslips: Payslip[]; lines: Line[]; rules: Rule[];
  penalties: Penalty[]; slips: Slip[]; notes: Note[]; audit: Audit[];
}

const STORE_KEY = 'aim.demo.store.v1';
const STORE_VERSION = 3;
export const DEMO_DEVICE_TOKEN = 'demo-kiosk-token-change-me-0000000001';
const TZ = 'Asia/Manila';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
const nowIso = () => new Date().toISOString();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

let db: Store;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { /* storage unavailable: keep in memory */ } }, 150);
}
function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const s = JSON.parse(raw) as Store; if (s.version === STORE_VERSION) return s; }
  } catch { /* fall through to a fresh seed */ }
  return seed();
}
export function resetDemo() {
  db = seed();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { /* ignore */ }
}
function store() { if (!db) db = load(); return db; }

// ---------------------------------------------------------------- errors & helpers
const fail = (status: number, msg: string): never => { throw new ApiError(status, msg); };
const notFound = (what: string) => fail(404, `${what} not found`);
const needReason = (r: unknown) => { if (typeof r !== 'string' || r.trim().length < 3) fail(400, 'Validation failed — reason: Please give a reason (min 3 characters)'); return (r as string).trim(); };

interface Ctx { user: User | null; device: Device | null; ip: string }
function audit(ctx: Ctx, e: { entity: string; entityId?: string | null; action: string; before?: unknown; after?: unknown; reason?: string | null }) {
  store().audit.unshift({ id: uid(), actorUserId: ctx.user?.id ?? null, actorDeviceId: ctx.device?.id ?? null, entity: e.entity, entityId: e.entityId ?? null, action: e.action, before: e.before ?? null, after: e.after ?? null, reason: e.reason ?? null, createdAt: nowIso() });
}
const STAFF: Role[] = ['owner', 'admin', 'manager'];
const ADMIN: Role[] = ['owner', 'admin'];
function requireUser(ctx: Ctx, roles: Role[]) {
  if (!ctx.user) fail(401, 'Not authenticated');
  if (!roles.includes(ctx.user!.role)) fail(403, 'Insufficient role');
  return ctx.user!;
}
function requireDevice(ctx: Ctx) {
  if (!ctx.device || !ctx.device.active) fail(401, 'Unknown or revoked device');
  ctx.device!.lastSeenAt = nowIso();
  return ctx.device!;
}
const settings = () => withDefaults(store().tenant.settings);
const findEmp = (id: string) => store().employees.find((e) => e.id === id) ?? notFound('Employee');
const name = (e: Employee) => `${e.firstName} ${e.lastName}`;
const publicEmployee = ({ pin, ...e }: Employee) => ({ ...e, hasPin: !!pin });
const userName = (id: string | null) => (id ? store().users.find((u) => u.id === id)?.name ?? null : null);
const zoneDay = (date: string) => DateTime.fromISO(date, { zone: TZ });

// ---------------------------------------------------------------- attendance
const DEFAULT_SCHEDULE: ScheduleInput = { startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] };
function dayRecords(from: string, to: string, employeeIds?: string[]) {
  const s = store();
  const st = settings();
  const emps = employeeIds ? s.employees.filter((e) => employeeIds.includes(e.id)) : s.employees.filter((e) => e.active);
  const start = zoneDay(from).startOf('day').toMillis();
  const end = zoneDay(to).plus({ days: 1 }).endOf('day').toMillis();
  const punches = s.punches.filter((p) => !p.voided && Date.parse(p.punchedAt) >= start && Date.parse(p.punchedAt) <= end);
  const holidays = s.holidays.filter((h) => h.date >= from && h.date <= to).map((h) => ({ date: h.date, type: h.type }));
  const records = new Map<string, DayRecord[]>();
  for (const e of emps) {
    const sch = s.schedules.find((x) => x.id === e.scheduleId);
    records.set(e.id, buildDailyRecords({
      punches: punches.filter((p) => p.employeeId === e.id).map((p) => ({ type: p.type, at: new Date(p.punchedAt) })),
      schedule: sch ? { startTime: sch.startTime, endTime: sch.endTime, breakMinutes: sch.breakMinutes, graceMinutes: sch.graceMinutes, restDays: sch.restDays } : DEFAULT_SCHEDULE,
      holidays, periodStart: from, periodEnd: to,
      options: { timezone: TZ, hoursPerDay: st.payroll.hoursPerDay, nightDiffStart: st.payroll.nightDiffStart, nightDiffEnd: st.payroll.nightDiffEnd, minOvertimeMinutes: st.payroll.minOvertimeMinutes, hireDate: e.hireDate },
    }));
  }
  return { employees: emps, records };
}
const today = () => DateTime.now().setZone(TZ).toISODate()!;
function weekSummary(employeeId: string) {
  const start = DateTime.now().setZone(TZ).startOf('week');
  const from = start.toISODate()!, to = start.plus({ days: 6 }).toISODate()!;
  const days = dayRecords(from, to, [employeeId]).records.get(employeeId) ?? [];
  const t = summarize(days);
  return {
    from, to,
    days: days.map((d) => ({ date: d.date, weekday: d.weekday, dayType: d.dayType, present: d.present, absent: d.absent, firstIn: d.firstIn, lastOut: d.lastOut, lateMinutes: d.lateMinutes, workedMinutes: d.workedMinutes, missingOut: d.missingOut })),
    daysWorked: t.daysPresent, lateCount: t.lateCount, lateMinutes: t.lateMinutes, workedHours: Math.round((t.workedMinutes / 60) * 10) / 10,
  };
}

// ---------------------------------------------------------------- penalties
function generatePenalties(from: string, to: string, employeeIds?: string[]) {
  const s = store();
  const rules = s.rules.filter((r) => r.active);
  if (!rules.length) return { created: 0 };
  let created = 0;
  for (const [employeeId, days] of dayRecords(from, to, employeeIds).records) {
    for (const c of evaluatePenalties(rules.map((r) => ({ id: r.id, name: r.name, config: r.config })), days, from)) {
      if (s.penalties.some((p) => p.employeeId === employeeId && p.ruleId === c.ruleId && p.sourceKey === c.sourceKey)) continue;
      const rule = rules.find((r) => r.id === c.ruleId)!;
      s.penalties.push({ id: uid(), employeeId, ruleId: c.ruleId, date: c.date, kind: c.kind, minutes: c.minutes, amount: c.amount, reason: c.reason, status: rule.autoApprove ? 'approved' : 'pending', sourceKey: c.sourceKey, issuedBy: null, decidedBy: null, decidedAt: rule.autoApprove ? nowIso() : null, decisionReason: rule.autoApprove ? 'Auto-approved by rule' : null, payrollRunId: null, createdAt: nowIso() });
      created++;
    }
  }
  return { created };
}

// ---------------------------------------------------------------- payroll
const getRun = (id: string) => store().runs.find((r) => r.id === id) ?? notFound('Payroll run');
const assertEditable = (run: Run) => { if (!['draft', 'review'].includes(run.status)) fail(409, `Payroll run is ${run.status} — reopen it before editing`); };

function computeRun(ctx: Ctx, runId: string, employeeIds?: string[]) {
  const s = store();
  const run = getRun(runId);
  assertEditable(run);
  const existing = s.payslips.filter((p) => p.runId === runId);
  const ids = employeeIds ?? [...new Set([...s.employees.filter((e) => e.active).map((e) => e.id), ...existing.map((p) => p.employeeId)])];
  generatePenalties(run.periodStart, run.periodEnd, ids);
  const { employees, records } = dayRecords(run.periodStart, run.periodEnd, ids);
  const st = settings();
  for (const emp of employees) {
    let slip = existing.find((p) => p.employeeId === emp.id);
    const saved = slip ? s.lines.filter((l) => l.payslipId === slip!.id) : [];
    const overrides: Record<string, LineOverride> = {};
    const manualLines: PayLine[] = [];
    for (const l of saved) {
      if (l.code.startsWith('MANUAL_')) { manualLines.push({ code: l.code, label: l.label, category: l.category, quantity: l.quantity, rate: l.rate, amount: l.amount, taxable: l.taxable, enabled: l.enabled, isManual: true, sortOrder: l.sortOrder }); continue; }
      const o: LineOverride = {};
      if (l.isManual) { o.amount = l.amount; o.label = l.label; }
      if (!l.enabled) o.enabled = false;
      if (Object.keys(o).length) overrides[l.code] = o;
    }
    const pens = s.penalties.filter((p) => p.employeeId === emp.id && p.status === 'approved' && p.date >= run.periodStart && p.date <= run.periodEnd && (!p.payrollRunId || p.payrollRunId === runId));
    const res = computePayslip({
      employee: { payType: emp.payType, rate: emp.rate, allowances: emp.allowances, exemptions: emp.exemptions },
      days: records.get(emp.id) ?? [], settings: st.payroll,
      run: { frequency: run.frequency, cutoff: run.cutoff, periodStart: run.periodStart, periodEnd: run.periodEnd },
      penalties: pens.map((p) => ({ id: p.id, date: p.date, amount: p.amount, reason: p.reason, kind: p.kind })),
      overrides, manualLines,
    });
    if (!slip) { slip = { id: uid(), runId, employeeId: emp.id, gross: 0, totalDeductions: 0, net: 0, summary: {} }; s.payslips.push(slip); }
    Object.assign(slip, { gross: res.gross, totalDeductions: res.totalDeductions, net: res.net, summary: { ...res.summary, rates: res.rates } });
    s.lines = s.lines.filter((l) => l.payslipId !== slip!.id);
    for (const l of res.lines) {
      const prev = saved.find((x) => x.code === l.code);
      s.lines.push({ ...l, id: prev?.id ?? uid(), payslipId: slip.id, updatedBy: prev?.updatedBy ?? null, updatedAt: prev?.updatedAt ?? null, editReason: prev?.editReason ?? null });
    }
    for (const p of pens) p.payrollRunId = runId;
  }
  run.computedAt = nowIso();
  run.status = 'review';
  if (!employeeIds) audit(ctx, { entity: 'payroll_run', entityId: runId, action: 'compute', after: { employees: employees.length } });
  return { computed: employees.length };
}

function lineContext(lineId: string) {
  const s = store();
  const line = s.lines.find((l) => l.id === lineId) ?? notFound('Payslip line');
  const slip = s.payslips.find((p) => p.id === line.payslipId)!;
  const run = getRun(slip.runId);
  return { line, slip, run };
}

// ---------------------------------------------------------------- stats
function efficiency(from: string, to: string) {
  const s = store();
  const start = zoneDay(from).startOf('day').toMillis(), end = zoneDay(to).endOf('day').toMillis();
  const inRange = s.slips.filter((x) => Date.parse(x.openedAt) >= start && Date.parse(x.openedAt) <= end);
  const ids = [...new Set(inRange.map((x) => x.serverEmployeeId))];
  const { records } = ids.length ? dayRecords(from, to, ids) : { records: new Map<string, DayRecord[]>() };
  return ids.map((id) => {
    const mine = inRange.filter((x) => x.serverEmployeeId === id);
    const ok = mine.filter((x) => x.status !== 'void');
    const served = ok.filter((x) => x.servedAt);
    const closed = ok.filter((x) => x.closedAt);
    const sales = ok.reduce((a, x) => a + x.amount, 0);
    const worked = summarize(records.get(id) ?? []).workedMinutes / 60;
    const hours = Math.max(worked, 1);
    const emp = s.employees.find((e) => e.id === id);
    return {
      employeeId: id, name: emp ? name(emp) : 'Unknown', slips: ok.length, voids: mine.length - ok.length,
      voidRate: mine.length ? (mine.length - ok.length) / mine.length : 0, sales, avgTicket: ok.length ? sales / ok.length : 0,
      items: ok.reduce((a, x) => a + x.itemsCount, 0),
      avgServiceMinutes: served.length ? served.reduce((a, x) => a + (Date.parse(x.servedAt!) - Date.parse(x.openedAt)) / 60000, 0) / served.length : null,
      avgCloseMinutes: closed.length ? closed.reduce((a, x) => a + (Date.parse(x.closedAt!) - Date.parse(x.openedAt)) / 60000, 0) / closed.length : null,
      hoursWorked: Math.round(worked * 10) / 10, slipsPerHour: ok.length / hours, salesPerHour: sales / hours,
    };
  }).sort((a, b) => b.sales - a.sales);
}
function serialGaps(from: string, to: string) {
  const start = zoneDay(from).startOf('day').toMillis(), end = zoneDay(to).endOf('day').toMillis();
  const groups = new Map<string, { branchId: string | null; prefix: string; width: number; nums: number[] }>();
  for (const x of store().slips) {
    const t = Date.parse(x.openedAt);
    if (t < start || t > end) continue;
    const m = x.serialNo.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const key = `${x.branchId}|${m[1]}`;
    const g = groups.get(key) ?? { branchId: x.branchId, prefix: m[1], width: m[2].length, nums: [] };
    g.nums.push(Number(m[2]));
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    const nums = [...new Set(g.nums)].sort((a, b) => a - b);
    const have = new Set(nums);
    const fmt = (n: number) => g.prefix + String(n).padStart(g.width, '0');
    const missing: string[] = [];
    for (let n = nums[0]; n <= nums[nums.length - 1] && missing.length < 200; n++) if (!have.has(n)) missing.push(fmt(n));
    if (missing.length) out.push({ branchId: g.branchId, prefix: g.prefix, missing, range: [fmt(nums[0]), fmt(nums[nums.length - 1])] });
  }
  return out;
}
function fighterCards(days = 30, employeeId?: string) {
  const s = store();
  const t = DateTime.now().setZone(TZ);
  const from = t.minus({ days: days - 1 }).toISODate()!, to = t.toISODate()!;
  const { employees, records } = dayRecords(from, to);
  const eff = efficiency(from, to);
  const team = { slipsPerHour: median(eff.map((e) => e.slipsPerHour)), salesPerHour: median(eff.map((e) => e.salesPerHour)), avgServiceMinutes: median(eff.map((e) => e.avgServiceMinutes ?? 0)) };
  const since90 = t.minus({ days: 90 }).toMillis();
  return employees.filter((e) => !employeeId || e.id === employeeId).map((e) => {
    const totals = summarize(records.get(e.id) ?? []);
    const ef = eff.find((x) => x.employeeId === e.id) ?? null;
    const notes = s.notes.filter((n) => n.employeeId === e.id && Date.parse(n.createdAt) >= since90);
    const approvedPenalties = s.penalties.filter((p) => p.employeeId === e.id && p.status === 'approved' && p.date >= from).length;
    const warnings = notes.filter((n) => n.category === 'warning' || n.category === 'incident').length;
    const rating = notes.reduce((a, n) => a + n.rating, 0);
    const card = computeCard({ ...totals, approvedPenalties, warningNotes: warnings, noteRatingSum: rating, efficiency: ef }, team);
    return { employeeId: e.id, name: name(e), employeeNo: e.employeeNo, position: e.position, department: e.department, photoUrl: e.photoUrl ?? null, ...card, period: { from, to, days }, raw: { ...totals, efficiency: ef, approvedPenalties, noteRating: rating, warnings } };
  }).sort((a, b) => b.overall - a.overall);
}

// ---------------------------------------------------------------- AI (Claude via the artifact `sample` capability)
type SampleFn = (input: { role: 'user' | 'assistant'; content: string }[], opts: Record<string, unknown>) => Promise<{ text: string }>;
let samplePromise: Promise<SampleFn | null> | null = null;
function getSample() {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!samplePromise) samplePromise = c?.use ? (c.use('sample') as Promise<SampleFn | null>).catch(() => null) : Promise.resolve(null);
  return samplePromise;
}
const AI_RULES = `You are "AI Manager", the HR analyst inside AI Manager HR, a timekeeping and payroll system for a Philippine restaurant (this is a demo with sample data).
Answer the owner's questions using ONLY data returned by your tools; never invent numbers. Amounts are Philippine pesos (₱, format like ₱12,345.67). Times are Asia/Manila.
Be concise: lead with the answer, then the key figures (a short plain-text table is fine), then at most 2 practical recommendations. Plain text only, no markdown headings.
For penalty or deduction questions, note that the Labor Code (Art. 113) restricts wage deductions. You are read-only: if asked to change data, say where in the app to do it.
Today is ${DateTime.now().setZone(TZ).toFormat('cccc, yyyy-LL-dd')}.`;
const compact = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x)));
const dateArg = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
function aiTools() {
  const s = store();
  const thirtyAgo = DateTime.now().setZone(TZ).minus({ days: 29 }).toISODate()!;
  return [
    { name: 'get_today', description: 'Live attendance for today: each employee, present, time in, late minutes.', execute: () => { const d = today(); const { employees, records } = dayRecords(d, d); return compact(employees.map((e) => { const r = records.get(e.id)![0]; return { name: name(e), position: e.position, firstIn: r.firstIn, lateMinutes: r.lateMinutes, dayType: r.dayType, clockedInNoOut: !!r.firstIn && !r.lastOut }; })); } },
    { name: 'find_employees', description: 'List employees with id, number, position, pay type and rate. Optional query filters by name/position.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, execute: (i: Record<string, unknown>) => { const q = String(i.query ?? '').toLowerCase(); return s.employees.filter((e) => !q || `${name(e)} ${e.position} ${e.employeeNo}`.toLowerCase().includes(q)).map((e) => ({ id: e.id, employeeNo: e.employeeNo, name: name(e), position: e.position, payType: e.payType, rate: e.rate, active: e.active })); } },
    { name: 'get_attendance_summary', description: 'Attendance totals per employee for a date range (days present/absent, late count & minutes, undertime, overtime and night-diff minutes, missing punches). Dates YYYY-MM-DD.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, employeeId: { type: 'string' } }, required: ['from', 'to'] }, execute: (i: Record<string, unknown>) => { const { employees, records } = dayRecords(dateArg(i.from, thirtyAgo), dateArg(i.to, today()), typeof i.employeeId === 'string' ? [i.employeeId] : undefined); return employees.map((e) => ({ employeeId: e.id, name: name(e), totals: summarize(records.get(e.id) ?? []) })); } },
    { name: 'get_fighter_cards', description: 'Performance ratings 0-99 per employee for the last N days: overall, tier and PUN (punctuality), ATT (attendance), SPD (service speed), HUS (order slips per hour), SAL (sales per hour), DIS (discipline), REP (management reputation).', inputSchema: { type: 'object', properties: { days: { type: 'number' } } }, execute: (i: Record<string, unknown>) => compact(fighterCards(Math.min(365, Math.max(7, Number(i.days) || 30))).map(({ raw, period: _p, ...c }) => ({ ...c, lates: raw.lateCount, absences: raw.daysAbsent }))) },
    { name: 'get_server_efficiency', description: 'Waiter efficiency from order slips for a date range: slips, voids, sales, avg ticket, avg service minutes, slips and sales per worked hour, plus missing OS serial numbers.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] }, execute: (i: Record<string, unknown>) => { const f = dateArg(i.from, thirtyAgo), t = dateArg(i.to, today()); return compact({ servers: efficiency(f, t), serialGaps: serialGaps(f, t) }); } },
    { name: 'get_payroll_runs', description: 'Payroll runs with status and totals (gross, deductions, net).', execute: () => compact(s.runs.map((r) => { const ps = s.payslips.filter((p) => p.runId === r.id); return { id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status, employees: ps.length, gross: ps.reduce((a, p) => a + p.gross, 0), deductions: ps.reduce((a, p) => a + p.totalDeductions, 0), net: ps.reduce((a, p) => a + p.net, 0) }; })) },
    { name: 'get_payroll_run_detail', description: 'Per-employee payslip lines for one payroll run (amounts, manual edits and reasons).', inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] }, execute: (i: Record<string, unknown>) => compact(s.payslips.filter((p) => p.runId === String(i.runId)).map((p) => ({ name: name(findEmp(p.employeeId)), gross: p.gross, deductions: p.totalDeductions, net: p.net, lines: s.lines.filter((l) => l.payslipId === p.id && l.category !== 'employer').map((l) => ({ label: l.label, category: l.category, amount: l.amount, enabled: l.enabled, manual: l.isManual, reason: l.editReason })) }))) },
    { name: 'get_penalties', description: 'Penalties with status pending/approved/waived (optional status filter).', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'approved', 'waived'] } } }, execute: (i: Record<string, unknown>) => s.penalties.filter((p) => !i.status || p.status === i.status).slice(0, 150).map((p) => ({ name: name(findEmp(p.employeeId)), date: p.date, kind: p.kind, amount: p.amount, reason: p.reason, status: p.status })) },
    { name: 'get_management_notes', description: 'Management notes (commendations, coaching, warnings, incidents).', execute: () => s.notes.map((n) => ({ name: name(findEmp(n.employeeId)), date: n.createdAt.slice(0, 10), category: n.category, title: n.title, body: n.body, rating: n.rating })) },
  ];
}
async function aiChat(messages: { role: 'user' | 'assistant'; content: string }[]) {
  const sample = await getSample();
  if (!sample) fail(503, 'AI chat needs the Claude viewer — open this page on claude.ai.');
  try {
    const { text } = await sample!([{ role: 'user', content: AI_RULES }, ...messages], { tools: aiTools() });
    return { reply: text };
  } catch (e) {
    const code = (e as { code?: string }).code;
    const copy: Record<string, string> = {
      not_granted: 'AI chat was not allowed for this page. Allow Claude in the artifact permissions to use it.',
      sampling_disabled: 'Claude is not available for this account.',
      rate_limited: 'Too many questions in a short time — wait a moment and ask again.',
      tools_unavailable: 'This Claude app version cannot run the data tools the AI Manager needs.',
      refused: 'Claude declined that question. Try rephrasing it.',
    };
    return fail(502, copy[code ?? ''] ?? 'The AI service had a problem — please try again.');
  }
}

// ---------------------------------------------------------------- router
type Handler = (ctx: Ctx, p: Record<string, string>, q: URLSearchParams, b: Record<string, unknown>) => unknown;
const routes: [string, RegExp, string[], Handler][] = [];
function on(method: string, pattern: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push([method, re, keys, h]);
}

// auth
on('POST', '/api/auth/login', (_c, _p, _q, b) => {
  const u = store().users.find((x) => x.email === String(b.email ?? '').toLowerCase() && x.password === b.password);
  if (!u) fail(401, 'Invalid email or password');
  const user = { userId: u!.id, tenantId: store().tenant.id, role: u!.role, employeeId: u!.employeeId, name: u!.name, email: u!.email, tenantName: store().tenant.name, timezone: TZ };
  return { token: u!.id, user };
});
on('GET', '/api/auth/me', (c) => { const u = requireUser(c, [...STAFF, 'employee']); return { userId: u.id, tenantId: store().tenant.id, role: u.role, employeeId: u.employeeId, name: u.name, tenantName: store().tenant.name, timezone: TZ }; });

// employees
on('GET', '/api/employees', (c) => { requireUser(c, STAFF); const s = store(); return [...s.employees].sort((a, b) => a.lastName.localeCompare(b.lastName)).map((e) => ({ ...publicEmployee(e), branchName: s.branches.find((x) => x.id === e.branchId)?.name ?? null, scheduleName: s.schedules.find((x) => x.id === e.scheduleId)?.name ?? null, fingerprints: s.templates.filter((t) => t.employeeId === e.id).length })); });
on('GET', '/api/employees/:id', (c, p) => { requireUser(c, STAFF); const e = findEmp(p.id); const s = store(); return { ...publicEmployee(e), fingerprints: s.templates.filter((t) => t.employeeId === e.id).map(({ template: _t, ...t }) => t), loginEmail: s.users.find((u) => u.employeeId === e.id)?.email ?? null }; });
on('POST', '/api/employees', (c, _p, _q, b) => {
  requireUser(c, ADMIN);
  if (!b.employeeNo || !b.firstName || !b.lastName) fail(400, 'Employee no., first and last name are required');
  if (store().employees.some((e) => e.employeeNo === b.employeeNo)) fail(409, 'Employee number already exists');
  const e: Employee = { id: uid(), employeeNo: String(b.employeeNo), firstName: String(b.firstName), lastName: String(b.lastName), position: (b.position as string) || null, department: (b.department as string) || null, branchId: (b.branchId as string) || null, scheduleId: (b.scheduleId as string) || null, payType: (b.payType as Employee['payType']) ?? 'daily', rate: Number(b.rate) || 0, allowances: (b.allowances as Employee['allowances']) ?? [], exemptions: (b.exemptions as Employee['exemptions']) ?? {}, tin: (b.tin as string) || null, sssNo: (b.sssNo as string) || null, philhealthNo: (b.philhealthNo as string) || null, pagibigNo: (b.pagibigNo as string) || null, hireDate: (b.hireDate as string) || null, active: b.active !== false, pin: null, biometricConsentAt: null, createdAt: nowIso() };
  store().employees.push(e);
  audit(c, { entity: 'employee', entityId: e.id, action: 'create', after: publicEmployee(e) });
  return publicEmployee(e);
});
on('PATCH', '/api/employees/:id', (c, p, _q, b) => {
  requireUser(c, ADMIN);
  const e = findEmp(p.id);
  const before = publicEmployee({ ...e });
  const { reason, ...changes } = b;
  if (changes.rate !== undefined && Number(changes.rate) !== e.rate && !reason) fail(400, 'A reason is required when changing the pay rate');
  const allowed = ['employeeNo', 'firstName', 'lastName', 'position', 'department', 'branchId', 'scheduleId', 'payType', 'rate', 'allowances', 'exemptions', 'tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'hireDate', 'active'];
  for (const k of allowed) if (k in changes) (e as unknown as Record<string, unknown>)[k] = k === 'rate' ? Number(changes[k]) : changes[k];
  audit(c, { entity: 'employee', entityId: e.id, action: 'update', before, after: publicEmployee(e), reason: (reason as string) ?? null });
  return publicEmployee(e);
});
on('POST', '/api/employees/:id/pin', (c, p, _q, b) => { requireUser(c, ADMIN); if (!/^\d{4,6}$/.test(String(b.pin))) fail(400, 'PIN must be 4–6 digits'); findEmp(p.id).pin = String(b.pin); audit(c, { entity: 'employee', entityId: p.id, action: 'set_pin' }); return { ok: true }; });
on('POST', '/api/employees/:id/login', (c, p, _q, b) => {
  requireUser(c, ADMIN);
  const e = findEmp(p.id);
  const email = String(b.email ?? '').toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email');
  if (String(b.password ?? '').length < 8) fail(400, 'Password must be at least 8 characters');
  const s = store();
  const existing = s.users.find((u) => u.employeeId === e.id);
  if (s.users.some((u) => u.email === email && u !== existing)) fail(409, 'Email already in use');
  if (existing) Object.assign(existing, { email, password: b.password });
  else s.users.push({ id: uid(), email, name: name(e), password: String(b.password), role: 'employee', employeeId: e.id });
  audit(c, { entity: 'employee', entityId: e.id, action: 'set_login', after: { email } });
  return { ok: true };
});
on('PUT', '/api/employees/:id/photo', (c, p, _q, b) => {
  requireUser(c, ADMIN);
  const e = findEmp(p.id);
  const url = b.photoUrl as string | null;
  if (url !== null && (typeof url !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(url))) fail(400, 'Photo must be a JPEG, PNG or WebP image');
  if (url && url.length > 400_000) fail(400, 'Photo is too large — use an image under 300 KB');
  e.photoUrl = url;
  audit(c, { entity: 'employee', entityId: e.id, action: url ? 'set_photo' : 'remove_photo' });
  return { ok: true };
});
on('GET', '/api/workforce/week', (c, _p, q) => {
  requireUser(c, STAFF);
  const s = store();
  const start = DateTime.fromISO(q.get('start') ?? today(), { zone: TZ }).startOf('week');
  const end = start.plus({ days: 6 }).toISODate()!;
  return weeklyPlan(
    s.employees.filter((e) => e.active).map((e) => {
      const sch = s.schedules.find((x) => x.id === e.scheduleId);
      return { ...e, schedule: sch ? { name: sch.name, startTime: sch.startTime, endTime: sch.endTime, restDays: sch.restDays } : null };
    }),
    start.toISODate()!,
    s.holidays.filter((h) => h.date >= start.toISODate()! && h.date <= end).map((h) => ({ date: h.date, type: h.type, name: h.name })),
    settings().payroll, tablesFor(start.toISODate()!),
  );
});
on('POST', '/api/employees/:id/biometric-consent', (c, p) => { requireUser(c, ADMIN); const e = findEmp(p.id); e.biometricConsentAt = nowIso(); audit(c, { entity: 'employee', entityId: e.id, action: 'biometric_consent' }); return { ok: true }; });
on('POST', '/api/employees/:id/fingerprints', (c, p, _q, b) => {
  requireUser(c, ADMIN);
  const e = findEmp(p.id);
  if (!e.biometricConsentAt) fail(400, "Record the employee's biometric consent (Data Privacy Act) before enrolling");
  const s = store();
  s.templates = s.templates.filter((t) => !(t.employeeId === e.id && t.finger === b.finger));
  s.templates.push({ id: uid(), employeeId: e.id, finger: String(b.finger), format: String(b.format), template: String(b.template), quality: (b.quality as number) ?? null, createdAt: nowIso() });
  audit(c, { entity: 'employee', entityId: e.id, action: 'fingerprint_enroll', after: { finger: b.finger } });
  return { ok: true };
});
on('DELETE', '/api/employees/:id/fingerprints', (c, p) => { requireUser(c, ADMIN); const s = store(); const n = s.templates.filter((t) => t.employeeId === p.id).length; s.templates = s.templates.filter((t) => t.employeeId !== p.id); audit(c, { entity: 'employee', entityId: p.id, action: 'fingerprint_delete_all', after: { count: n } }); return { deleted: n }; });

// settings, branches, schedules, holidays, devices, audit
on('GET', '/api/settings', (c) => { requireUser(c, STAFF); const t = store().tenant; return { name: t.name, timezone: t.timezone, currency: t.currency, settings: settings() }; });
on('PATCH', '/api/settings', (c, _p, _q, b) => {
  requireUser(c, ADMIN);
  const t = store().tenant;
  const before = settings();
  const payroll = (b.payroll ?? {}) as Partial<TenantSettings['payroll']>;
  t.settings = { payroll: { ...before.payroll, ...payroll, components: { ...before.payroll.components, ...(payroll.components ?? {}) } } };
  audit(c, { entity: 'tenant', entityId: t.id, action: 'update_settings', before, after: t.settings });
  return { ok: true, settings: t.settings };
});
on('GET', '/api/branches', (c) => { requireUser(c, STAFF); return store().branches; });
on('GET', '/api/schedules', (c) => { requireUser(c, STAFF); return store().schedules; });
on('POST', '/api/schedules', (c, _p, _q, b) => { requireUser(c, ADMIN); const sch = { id: uid(), name: String(b.name), startTime: String(b.startTime), endTime: String(b.endTime), breakMinutes: Number(b.breakMinutes), graceMinutes: Number(b.graceMinutes), restDays: (b.restDays as number[]) ?? [] }; store().schedules.push(sch); audit(c, { entity: 'schedule', entityId: sch.id, action: 'create', after: sch }); return sch; });
on('GET', '/api/holidays', (c, _p, q) => { requireUser(c, STAFF); const f = q.get('from'), t = q.get('to'); return store().holidays.filter((h) => (!f || h.date >= f) && (!t || h.date <= t)).sort((a, b) => a.date.localeCompare(b.date)); });
on('POST', '/api/holidays', (c, _p, _q, b) => { requireUser(c, ADMIN); const s = store(); s.holidays = s.holidays.filter((h) => h.date !== b.date); const h = { id: uid(), date: String(b.date), name: String(b.name), type: b.type as Holiday['type'] }; s.holidays.push(h); audit(c, { entity: 'holiday', entityId: h.id, action: 'upsert', after: h }); return h; });
on('DELETE', '/api/holidays/:id', (c, p) => { requireUser(c, ADMIN); const s = store(); const h = s.holidays.find((x) => x.id === p.id) ?? notFound('Holiday'); s.holidays = s.holidays.filter((x) => x !== h); audit(c, { entity: 'holiday', entityId: p.id, action: 'delete', before: h }); return { ok: true }; });
on('GET', '/api/devices', (c) => { requireUser(c, ADMIN); return store().devices.map(({ token: _t, ...d }) => d); });
on('POST', '/api/devices', (c, _p, _q, b) => { requireUser(c, ADMIN); const token = `dev-${uid()}${uid()}`.replace(/-/g, ''); const d = { id: uid(), name: String(b.name), driver: String(b.driver ?? 'simulator'), active: true, lastSeenAt: null, createdAt: nowIso(), token, branchId: null }; store().devices.unshift(d); audit(c, { entity: 'device', entityId: d.id, action: 'register', after: { name: d.name } }); return { id: d.id, name: d.name, driver: d.driver, token }; });
on('POST', '/api/devices/:id/revoke', (c, p) => { requireUser(c, ADMIN); const d = store().devices.find((x) => x.id === p.id) ?? notFound('Device'); d.active = false; audit(c, { entity: 'device', entityId: d.id, action: 'revoke' }); return { ok: true }; });
on('GET', '/api/audit', (c) => { requireUser(c, ADMIN); return store().audit.slice(0, 200).map((a) => ({ ...a, actorName: userName(a.actorUserId) })); });

// kiosk
on('GET', '/api/kiosk/info', (c) => { const d = requireDevice(c); return { tenantName: store().tenant.name, timezone: TZ, deviceName: d.name, driver: d.driver }; });
on('GET', '/api/kiosk/templates', (c) => { requireDevice(c); const s = store(); return s.templates.flatMap((t) => { const e = s.employees.find((x) => x.id === t.employeeId && x.active); return e ? [{ employeeId: e.id, firstName: e.firstName, lastName: e.lastName, employeeNo: e.employeeNo, finger: t.finger, format: t.format, template: t.template }] : []; }); });
on('GET', '/api/kiosk/employees', (c) => { requireDevice(c); return store().employees.filter((e) => e.active).map((e) => ({ id: e.id, employeeNo: e.employeeNo, firstName: e.firstName, lastName: e.lastName })); });
function recordPunch(c: Ctx, dev: Device, emp: Employee, o: { clientUuid: string; punchedAt?: string; method: 'fingerprint' | 'pin'; matchScore?: number }) {
  const s = store();
  const already = s.punches.find((p) => p.clientUuid === o.clientUuid);
  if (already) return { punch: already, duplicate: true };
  const now = Date.now();
  let at = o.punchedAt ? Date.parse(o.punchedAt) : now;
  if (Number.isNaN(at) || at > now + 120_000) at = now;
  const last = s.punches.filter((p) => p.employeeId === emp.id && !p.voided && Date.parse(p.punchedAt) < at).sort((a, b) => Date.parse(b.punchedAt) - Date.parse(a.punchedAt))[0];
  if (last && at - Date.parse(last.punchedAt) < 60_000) return { punch: last, duplicate: true };
  const type: 'in' | 'out' = last && last.type === 'in' && at - Date.parse(last.punchedAt) < 18 * 3600_000 ? 'out' : 'in';
  const punch: Punch = { id: uid(), employeeId: emp.id, deviceId: dev.id, type, punchedAt: new Date(at).toISOString(), method: o.method, matchScore: o.matchScore ?? null, clientUuid: o.clientUuid, voided: false, createdBy: null, reason: null };
  s.punches.push(punch);
  if (o.method === 'pin') audit(c, { entity: 'attendance', entityId: punch.id, action: 'pin_punch', after: { employeeId: emp.id, type } });
  return { punch, duplicate: false };
}
const punchReply = (emp: Employee, r: { punch: Punch; duplicate: boolean }) => ({ duplicate: r.duplicate, type: r.punch.type, punchedAt: r.punch.punchedAt, employee: { id: emp.id, name: name(emp), employeeNo: emp.employeeNo, position: emp.position, photoUrl: emp.photoUrl ?? null }, week: weekSummary(emp.id) });
on('POST', '/api/kiosk/punch', (c, _p, _q, b) => { const d = requireDevice(c); const e = findEmp(String(b.employeeId)); if (!e.active) notFound('Employee'); return punchReply(e, recordPunch(c, d, e, { clientUuid: String(b.clientUuid), punchedAt: b.punchedAt as string, method: 'fingerprint', matchScore: b.matchScore as number })); });
on('POST', '/api/kiosk/pin-punch', (c, _p, _q, b) => { const d = requireDevice(c); const e = store().employees.find((x) => x.employeeNo === String(b.employeeNo).trim() && x.active); if (!e?.pin || e.pin !== b.pin) fail(401, 'Wrong employee number or PIN'); return punchReply(e!, recordPunch(c, d, e!, { clientUuid: String(b.clientUuid), punchedAt: b.punchedAt as string, method: 'pin' })); });
on('POST', '/api/kiosk/week', (c, _p, _q, b) => { requireDevice(c); const e = findEmp(String(b.employeeId)); return { employee: { id: e.id, name: name(e), employeeNo: e.employeeNo, position: e.position, photoUrl: e.photoUrl ?? null }, week: weekSummary(e.id) }; });

// attendance
on('GET', '/api/attendance/today', (c, _p, q) => {
  requireUser(c, STAFF);
  const date = q.get('date') ?? today();
  const { employees, records } = dayRecords(date, date);
  const start = zoneDay(date).startOf('day').toMillis(), end = zoneDay(date).endOf('day').toMillis();
  const punches = store().punches.filter((p) => !p.voided && Date.parse(p.punchedAt) >= start && Date.parse(p.punchedAt) <= end).sort((a, b) => b.punchedAt.localeCompare(a.punchedAt));
  const rows = employees.map((e) => {
    const r = records.get(e.id)![0];
    const last = punches.find((x) => x.employeeId === e.id);
    const status = last?.type === 'in' ? 'in' : last?.type === 'out' ? 'out' : r.dayType === 'rest' ? 'rest_day' : r.holiday ? 'holiday' : 'not_in';
    return { employeeId: e.id, name: name(e), employeeNo: e.employeeNo, position: e.position, photoUrl: e.photoUrl ?? null, status, lastPunchAt: last?.punchedAt ?? null, record: r };
  });
  return { date, counts: { total: rows.length, clockedIn: rows.filter((r) => r.status === 'in').length, late: rows.filter((r) => r.record.lateMinutes > 0).length, notIn: rows.filter((r) => r.status === 'not_in').length }, feed: punches.slice(0, 30).map((x) => ({ ...x, name: rows.find((r) => r.employeeId === x.employeeId)?.name })), rows };
});
on('GET', '/api/attendance/records', (c, _p, q) => {
  requireUser(c, STAFF);
  const eid = q.get('employeeId');
  const { employees, records } = dayRecords(q.get('from')!, q.get('to')!, eid ? [eid] : undefined);
  return employees.map((e) => { const days = records.get(e.id) ?? []; return { employeeId: e.id, name: name(e), employeeNo: e.employeeNo, totals: summarize(days), days }; });
});
on('GET', '/api/attendance/punches', (c, _p, q) => {
  requireUser(c, STAFF);
  const start = zoneDay(q.get('from')!).startOf('day').toMillis(), end = zoneDay(q.get('to')!).endOf('day').toMillis();
  const s = store();
  return s.punches.filter((p) => p.employeeId === q.get('employeeId') && Date.parse(p.punchedAt) >= start && Date.parse(p.punchedAt) <= end).sort((a, b) => a.punchedAt.localeCompare(b.punchedAt)).map((p) => ({ ...p, createdByName: userName(p.createdBy), deviceName: s.devices.find((d) => d.id === p.deviceId)?.name ?? null }));
});
on('POST', '/api/attendance/punches', (c, _p, _q, b) => {
  const u = requireUser(c, STAFF);
  const reason = needReason(b.reason);
  findEmp(String(b.employeeId));
  const at = Date.parse(String(b.punchedAt));
  if (Number.isNaN(at)) fail(400, 'Enter a valid date and time');
  const punch: Punch = { id: uid(), employeeId: String(b.employeeId), deviceId: null, type: b.type === 'out' ? 'out' : 'in', punchedAt: new Date(at).toISOString(), method: 'manual', matchScore: null, clientUuid: null, voided: false, createdBy: u.id, reason };
  store().punches.push(punch);
  audit(c, { entity: 'attendance', entityId: punch.id, action: 'manual_punch', after: punch, reason });
  return punch;
});
on('POST', '/api/attendance/punches/:id/void', (c, p, _q, b) => { requireUser(c, STAFF); const reason = needReason(b.reason); const x = store().punches.find((y) => y.id === p.id) ?? notFound('Punch'); const before = { ...x }; x.voided = true; audit(c, { entity: 'attendance', entityId: x.id, action: 'void_punch', before, after: x, reason }); return x; });

// payroll
on('GET', '/api/payroll/runs', (c) => { requireUser(c, STAFF); const s = store(); return [...s.runs].sort((a, b) => b.periodStart.localeCompare(a.periodStart)).map((r) => { const ps = s.payslips.filter((p) => p.runId === r.id); return { ...r, employees: ps.length, gross: ps.reduce((a, p) => a + p.gross, 0), net: ps.reduce((a, p) => a + p.net, 0) }; }); });
on('POST', '/api/payroll/runs', (c, _p, _q, b) => {
  const u = requireUser(c, ADMIN);
  const ps = String(b.periodStart ?? ''), pe = String(b.periodEnd ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ps) || !/^\d{4}-\d{2}-\d{2}$/.test(pe)) fail(400, 'Enter the period start and end dates');
  if (pe < ps) fail(400, 'Period end is before period start');
  const run: Run = { id: uid(), periodStart: ps, periodEnd: pe, payDate: (b.payDate as string) || null, frequency: settings().payroll.frequency, cutoff: Number(ps.slice(8, 10)) > 15 ? 2 : 1, status: 'draft', createdBy: u.id, approvedBy: null, approvedAt: null, computedAt: null, branchId: null, notes: null, createdAt: nowIso() };
  store().runs.push(run);
  audit(c, { entity: 'payroll_run', entityId: run.id, action: 'create', after: run });
  return run;
});
on('GET', '/api/payroll/runs/:id', (c, p) => {
  requireUser(c, STAFF);
  const s = store();
  const run = getRun(p.id);
  const payslips = s.payslips.filter((x) => x.runId === run.id).map((x) => {
    const e = findEmp(x.employeeId);
    return { ...x, employee: { id: e.id, name: name(e), employeeNo: e.employeeNo, position: e.position }, lines: s.lines.filter((l) => l.payslipId === x.id).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({ ...l, editorName: userName(l.updatedBy) })) };
  }).sort((a, b) => findEmp(a.employeeId).lastName.localeCompare(findEmp(b.employeeId).lastName));
  const totals = payslips.reduce((t, x) => ({ gross: t.gross + x.gross, deductions: t.deductions + x.totalDeductions, net: t.net + x.net, employer: t.employer + x.lines.filter((l) => l.category === 'employer' && l.enabled).reduce((a, l) => a + l.amount, 0) }), { gross: 0, deductions: 0, net: 0, employer: 0 });
  return { ...run, createdByName: userName(run.createdBy), approvedByName: userName(run.approvedBy), totals: { gross: r2(totals.gross), deductions: r2(totals.deductions), net: r2(totals.net), employer: r2(totals.employer) }, payslips };
});
on('POST', '/api/payroll/runs/:id/compute', (c, p) => { requireUser(c, STAFF); return computeRun(c, p.id); });
on('POST', '/api/payroll/runs/:id/:action', (c, p, _q, b) => {
  const u = requireUser(c, ADMIN);
  const T: Record<string, { from: Run['status'][]; to: Run['status']; reason: boolean }> = {
    approve: { from: ['review'], to: 'approved', reason: false }, reopen: { from: ['approved', 'review'], to: 'draft', reason: true },
    mark_paid: { from: ['approved'], to: 'paid', reason: false }, void: { from: ['draft', 'review', 'approved'], to: 'void', reason: true },
  };
  const t = T[p.action] ?? fail(400, 'Unknown action');
  const reason = t.reason ? needReason(b.reason) : null;
  const run = getRun(p.id);
  if (!t.from.includes(run.status)) fail(409, `Cannot ${p.action} a run that is ${run.status}`);
  const before = run.status;
  run.status = t.to;
  if (p.action === 'approve') Object.assign(run, { approvedBy: u.id, approvedAt: nowIso() });
  if (p.action === 'reopen') Object.assign(run, { approvedBy: null, approvedAt: null });
  if (p.action === 'void') for (const x of store().penalties) if (x.payrollRunId === run.id) x.payrollRunId = null;
  audit(c, { entity: 'payroll_run', entityId: run.id, action: p.action, before: { status: before }, after: { status: t.to }, reason });
  return { ok: true, status: t.to };
});
on('PATCH', '/api/payroll/lines/:id', (c, p, _q, b) => {
  const u = requireUser(c, STAFF);
  const reason = needReason(b.reason);
  const { line, slip, run } = lineContext(p.id);
  assertEditable(run);
  const change: { amount?: number; enabled?: boolean; label?: string } = {};
  if (b.amount !== undefined) { const a = Number(b.amount); if (!(a >= 0)) fail(400, 'Amount must be zero or more'); change.amount = a; }
  if (b.enabled !== undefined) change.enabled = !!b.enabled;
  if (b.label !== undefined) change.label = String(b.label);
  const before = { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, label: line.label, amount: line.amount, enabled: line.enabled };
  if (change.amount !== undefined) { line.amount = change.amount; line.isManual = true; }
  if (change.label !== undefined) { line.label = change.label; line.isManual = true; }
  if (change.enabled !== undefined) line.enabled = change.enabled;
  Object.assign(line, { updatedBy: u.id, updatedAt: nowIso(), editReason: reason });
  audit(c, { entity: 'payslip_line', entityId: line.id, action: 'edit', before, after: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, ...change }, reason });
  computeRun(c, run.id, [slip.employeeId]);
  return { ok: true };
});
on('POST', '/api/payroll/lines/:id/reset', (c, p, _q, b) => {
  const u = requireUser(c, STAFF);
  const reason = needReason(b.reason);
  const { line, slip, run } = lineContext(p.id);
  assertEditable(run);
  audit(c, { entity: 'payslip_line', entityId: line.id, action: 'reset', before: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, amount: line.amount, enabled: line.enabled }, reason });
  Object.assign(line, { isManual: false, enabled: true, updatedBy: u.id, updatedAt: nowIso(), editReason: reason });
  computeRun(c, run.id, [slip.employeeId]);
  return { ok: true };
});
on('DELETE', '/api/payroll/lines/:id', (c, p, _q, b) => {
  requireUser(c, STAFF);
  const reason = needReason(b.reason);
  const { line, slip, run } = lineContext(p.id);
  assertEditable(run);
  if (!line.code.startsWith('MANUAL_')) fail(400, 'Only manual lines can be removed — switch computed lines off instead');
  store().lines = store().lines.filter((l) => l !== line);
  audit(c, { entity: 'payslip_line', entityId: line.id, action: 'remove_manual', before: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, label: line.label, amount: line.amount }, reason });
  computeRun(c, run.id, [slip.employeeId]);
  return { ok: true };
});
on('POST', '/api/payroll/payslips/:id/lines', (c, p, _q, b) => {
  const u = requireUser(c, STAFF);
  const reason = needReason(b.reason);
  const slip = store().payslips.find((x) => x.id === p.id) ?? notFound('Payslip');
  const run = getRun(slip.runId);
  assertEditable(run);
  const amount = Number(b.amount);
  if (!b.label || !(amount > 0)) fail(400, 'Enter a label and an amount above zero');
  const code = `MANUAL_${Date.now().toString(36).toUpperCase()}`;
  const category = b.category === 'earning' ? 'earning' : 'deduction';
  const line: Line = { id: uid(), payslipId: slip.id, code, label: String(b.label), category, quantity: null, rate: null, amount, taxable: !!b.taxable, enabled: true, isManual: true, sortOrder: 500, updatedBy: u.id, updatedAt: nowIso(), editReason: reason };
  store().lines.push(line);
  audit(c, { entity: 'payslip_line', entityId: line.id, action: 'add_manual', after: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, label: line.label, category, amount, code }, reason });
  computeRun(c, run.id, [slip.employeeId]);
  return { ok: true, code };
});
on('GET', '/api/payroll/runs/:id/audit', (c, p) => {
  requireUser(c, STAFF);
  getRun(p.id);
  const runOf = (x: unknown) => (x && typeof x === 'object' ? (x as Record<string, unknown>).runId : undefined);
  return store().audit.filter((a) => a.entityId === p.id || runOf(a.before) === p.id || runOf(a.after) === p.id).map((a) => ({ ...a, actorName: userName(a.actorUserId) }));
});

// penalties
on('GET', '/api/penalty-rules', (c) => { requireUser(c, STAFF); return store().rules; });
on('POST', '/api/penalty-rules', (c, _p, _q, b) => { requireUser(c, ADMIN); if (!b.name) fail(400, 'Give the rule a name'); const r: Rule = { id: uid(), name: String(b.name), config: b.config as PenaltyRuleConfig, active: b.active !== false, autoApprove: !!b.autoApprove, createdAt: nowIso() }; store().rules.push(r); audit(c, { entity: 'penalty_rule', entityId: r.id, action: 'create', after: r }); return r; });
on('PATCH', '/api/penalty-rules/:id', (c, p, _q, b) => { requireUser(c, ADMIN); const r = store().rules.find((x) => x.id === p.id) ?? notFound('Rule'); const before = { ...r }; Object.assign(r, b); audit(c, { entity: 'penalty_rule', entityId: r.id, action: 'update', before, after: r }); return r; });
on('GET', '/api/penalties', (c, _p, q) => {
  requireUser(c, STAFF);
  const st = q.get('status'), eid = q.get('employeeId');
  return store().penalties.filter((x) => (!st || x.status === st) && (!eid || x.employeeId === eid)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 500).map((x) => { const e = findEmp(x.employeeId); return { ...x, employeeName: name(e), employeeNo: e.employeeNo, decidedByName: userName(x.decidedBy) }; });
});
on('POST', '/api/penalties/generate', (c, _p, _q, b) => { requireUser(c, STAFF); const r = generatePenalties(String(b.from), String(b.to)); audit(c, { entity: 'penalty', action: 'generate', after: { ...b, ...r } }); return r; });
on('POST', '/api/penalties', (c, _p, _q, b) => {
  const u = requireUser(c, STAFF);
  const reason = needReason(b.reason);
  findEmp(String(b.employeeId));
  const amount = Number(b.amount);
  if (!(amount > 0)) fail(400, 'Enter an amount above zero');
  const x: Penalty = { id: uid(), employeeId: String(b.employeeId), ruleId: null, date: String(b.date), kind: String(b.kind ?? 'disciplinary'), minutes: null, amount, reason, status: 'pending', sourceKey: null, issuedBy: u.id, decidedBy: null, decidedAt: null, decisionReason: null, payrollRunId: null, createdAt: nowIso() };
  store().penalties.push(x);
  audit(c, { entity: 'penalty', entityId: x.id, action: 'create', after: x, reason });
  return x;
});
on('POST', '/api/penalties/:id/decide', (c, p, _q, b) => {
  const u = requireUser(c, STAFF);
  const x = store().penalties.find((y) => y.id === p.id) ?? notFound('Penalty');
  if (x.payrollRunId && ['approved', 'paid'].includes(getRun(x.payrollRunId).status)) fail(409, 'Penalty is already in an approved payroll run');
  const decision = b.decision === 'waived' ? 'waived' : 'approved';
  if (decision === 'waived') needReason(b.reason);
  const before = { ...x };
  Object.assign(x, { status: decision, decidedBy: u.id, decidedAt: nowIso(), decisionReason: (b.reason as string) ?? null, payrollRunId: decision === 'waived' ? null : x.payrollRunId });
  audit(c, { entity: 'penalty', entityId: x.id, action: decision, before, after: x, reason: (b.reason as string) ?? null });
  return x;
});

// efficiency, notes, stats, me
on('GET', '/api/order-slips', (c, _p, q) => { requireUser(c, STAFF); const start = zoneDay(q.get('from')!).startOf('day').toMillis(), end = zoneDay(q.get('to')!).endOf('day').toMillis(); return store().slips.filter((x) => Date.parse(x.openedAt) >= start && Date.parse(x.openedAt) <= end).slice(0, 1000).map((x) => ({ ...x, serverName: name(findEmp(x.serverEmployeeId)) })); });
on('POST', '/api/order-slips', (c, _p, _q, b) => {
  requireUser(c, STAFF);
  const input = (Array.isArray(b.slips) ? b.slips : [b]) as Record<string, unknown>[];
  const s = store();
  let inserted = 0;
  for (const x of input) {
    if (!x.serverEmployeeId || !x.serialNo || !x.openedAt || Number.isNaN(Date.parse(String(x.openedAt)))) fail(400, 'Each OS needs a server, a serial number and an opened time');
    const branchId = (x.branchId as string) ?? s.branches[0]?.id ?? null;
    if (s.slips.some((y) => y.serialNo === x.serialNo && y.branchId === branchId)) continue;
    s.slips.push({ id: uid(), branchId, serverEmployeeId: String(x.serverEmployeeId), serialNo: String(x.serialNo), tableNo: (x.tableNo as string) || null, openedAt: new Date(String(x.openedAt)).toISOString(), servedAt: x.servedAt ? new Date(String(x.servedAt)).toISOString() : null, closedAt: x.closedAt ? new Date(String(x.closedAt)).toISOString() : null, amount: Number(x.amount) || 0, itemsCount: Number(x.itemsCount) || 0, status: (x.status as Slip['status']) ?? 'closed', voidReason: null });
    inserted++;
  }
  audit(c, { entity: 'order_slip', action: 'import', after: { received: input.length, inserted } });
  return { received: input.length, inserted, skippedDuplicates: input.length - inserted };
});
on('GET', '/api/efficiency', (c, _p, q) => { requireUser(c, STAFF); const f = q.get('from')!, t = q.get('to')!; return { from: f, to: t, servers: efficiency(f, t), serialGaps: serialGaps(f, t) }; });
on('GET', '/api/notes', (c, _p, q) => { requireUser(c, STAFF); const eid = q.get('employeeId'); return store().notes.filter((n) => !eid || n.employeeId === eid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((n) => ({ ...n, authorName: userName(n.authorId), employeeName: name(findEmp(n.employeeId)) })); });
on('POST', '/api/notes', (c, _p, _q, b) => { const u = requireUser(c, STAFF); findEmp(String(b.employeeId)); if (!b.title || !b.body) fail(400, 'Enter a title and details'); const n: Note = { id: uid(), employeeId: String(b.employeeId), authorId: u.id, category: String(b.category), title: String(b.title), body: String(b.body), rating: Math.max(-3, Math.min(3, Number(b.rating) || 0)), visibleToEmployee: !!b.visibleToEmployee, createdAt: nowIso() }; store().notes.push(n); audit(c, { entity: 'note', entityId: n.id, action: 'create', after: n }); return n; });
on('DELETE', '/api/notes/:id', (c, p) => { requireUser(c, STAFF); const s = store(); const n = s.notes.find((x) => x.id === p.id) ?? notFound('Note'); s.notes = s.notes.filter((x) => x !== n); audit(c, { entity: 'note', entityId: n.id, action: 'delete', before: n }); return { ok: true }; });
on('GET', '/api/stats/cards', (c, _p, q) => { requireUser(c, STAFF); return fighterCards(Number(q.get('days')) || 30, q.get('employeeId') ?? undefined); });
on('GET', '/api/dashboard', (c) => {
  requireUser(c, STAFF);
  const s = store();
  const t = DateTime.now().setZone(TZ);
  const todayIso = t.toISODate()!;
  const from = t.minus({ days: 13 }).toISODate()!;
  const cutoff = currentCutoff(todayIso, settings().payroll.frequency);
  const { employees, records } = dayRecords(from < cutoff.start ? from : cutoff.start, todayIso);
  const last14 = new Map([...records].map(([id, days]) => [id, days.filter((d) => d.date >= from)]));
  const inCutoff = new Map([...records].map(([id, days]) => [id, days.filter((d) => d.date >= cutoff.start)]));
  const totals = summarize([...last14.values()].flat());
  const lastRun = [...s.runs].sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  const ps = lastRun ? s.payslips.filter((p) => p.runId === lastRun.id) : [];
  const cutoffRun = s.runs.find((r) => r.periodStart === cutoff.start && r.status !== 'void');
  const week = t.minus({ days: 6 }).toISODate()!;
  const pendingPenalties = s.penalties.filter((x) => x.status === 'pending').length;
  return {
    activeEmployees: employees.length, last14: totals, attendanceRate: totals.scheduledDays ? totals.daysPresent / totals.scheduledDays : null,
    pendingPenalties, lastRun: lastRun ? { ...lastRun, net: ps.reduce((a, p) => a + p.net, 0), gross: ps.reduce((a, p) => a + p.gross, 0) } : null,
    trend: dailyTrend(records, from, todayIso),
    cutoff: { ...cutoff, run: cutoffRun ? { id: cutoffRun.id, status: cutoffRun.status } : null },
    overtime: overtimeLeaders(employees, inCutoff, settings().payroll),
    alerts: {
      pendingPenalties,
      missingTimeouts: [...records.values()].flat().filter((d) => d.date >= week && d.missingOut).length,
      missingSerials: serialGaps(from, todayIso).reduce((a, g) => a + g.missing.length, 0),
      notEnrolled: employees.filter((e) => !s.templates.some((x) => x.employeeId === e.id)).length,
    },
  };
});
const meEmp = (c: Ctx) => { const u = requireUser(c, [...STAFF, 'employee']); if (!u.employeeId) fail(403, 'This login is not linked to an employee'); return u.employeeId!; };
on('GET', '/api/me/week', (c) => weekSummary(meEmp(c)));
on('GET', '/api/me/card', (c) => fighterCards(30, meEmp(c))[0] ?? null);
on('GET', '/api/me/payslips', (c) => {
  const eid = meEmp(c);
  const s = store();
  return s.payslips.filter((p) => p.employeeId === eid).map((p) => ({ p, run: getRun(p.runId) })).filter(({ run }) => ['approved', 'paid'].includes(run.status)).sort((a, b) => b.run.periodStart.localeCompare(a.run.periodStart))
    .map(({ p, run }) => ({ id: p.id, periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate, status: run.status, gross: p.gross, totalDeductions: p.totalDeductions, net: p.net, lines: s.lines.filter((l) => l.payslipId === p.id && l.enabled && l.category !== 'employer').sort((a, b) => a.sortOrder - b.sortOrder).map(({ code, label, category, quantity, rate, amount }) => ({ code, label, category, quantity, rate, amount })) }));
});
on('GET', '/api/me/notes', (c) => { const eid = meEmp(c); return store().notes.filter((n) => n.employeeId === eid && n.visibleToEmployee).map(({ id, category, title, body, createdAt }) => ({ id, category, title, body, createdAt })); });
on('GET', '/api/ai/status', async (c) => { requireUser(c, ADMIN); return { enabled: !!(await getSample()) }; });
on('POST', '/api/ai/chat', (c, _p, _q, b) => { requireUser(c, ADMIN); const m = (b.messages as { role: 'user' | 'assistant'; content: string }[]) ?? []; if (!m.length || m[m.length - 1].role !== 'user') fail(400, 'Ask a question first'); return aiChat(m); });
on('GET', '/api/health', () => ({ ok: true }));

/** Entry point used by api.ts in the demo build. */
export async function demoRequest(method: string, path: string, body: unknown, token: string | null, deviceToken: string | null) {
  const s = store();
  const url = new URL(path, 'http://demo.local');
  const ctx: Ctx = { user: s.users.find((u) => u.id === token) ?? null, device: s.devices.find((d) => d.token === deviceToken) ?? null, ip: 'demo' };
  for (const [m, re, keys, h] of routes) {
    if (m !== method) continue;
    const match = url.pathname.match(re);
    if (!match) continue;
    const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const result = await h(ctx, params, url.searchParams, (body ?? {}) as Record<string, unknown>);
    if (method !== 'GET' || path.startsWith('/api/kiosk/info')) save();
    return JSON.parse(JSON.stringify(result ?? null));
  }
  return fail(404, 'Not found');
}

// ---------------------------------------------------------------- seed
function seed(): Store {
  let rnd = 42;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const s: Store = {
    version: STORE_VERSION,
    tenant: { id: uid(), name: 'Demo Restaurant PH', timezone: TZ, currency: 'PHP', settings: structuredClone(DEFAULT_SETTINGS) },
    branches: [{ id: uid(), name: 'BGC Main', address: 'Bonifacio Global City, Taguig' }],
    schedules: [], employees: [], users: [], devices: [], templates: [], punches: [], holidays: [], runs: [], payslips: [], lines: [], rules: [], penalties: [], slips: [], notes: [], audit: [],
  };
  db = s;
  const branchId = s.branches[0].id;
  const daySched: Schedule = { id: uid(), name: 'Day 09:00–18:00', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] };
  const midSched: Schedule = { id: uid(), name: 'Mid 14:00–23:00', startTime: '14:00', endTime: '23:00', breakMinutes: 60, graceMinutes: 5, restDays: [1] };
  const dayWed: Schedule = { id: uid(), name: 'Day 09:00–18:00 (Wed off)', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [3] };
  const midTue: Schedule = { id: uid(), name: 'Mid 14:00–23:00 (Tue off)', startTime: '14:00', endTime: '23:00', breakMinutes: 60, graceMinutes: 5, restDays: [2] };
  const early: Schedule = { id: uid(), name: 'Early 06:00–15:00 (Sat off)', startTime: '06:00', endTime: '15:00', breakMinutes: 60, graceMinutes: 5, restDays: [6] };
  s.schedules.push(daySched, midSched, dayWed, midTue, early);
  const owner: User = { id: uid(), email: 'admin@demo.ph', name: 'Maria Santos (Owner)', password: 'Admin123!', role: 'owner', employeeId: null };
  s.users.push(owner, { id: uid(), email: 'manager@demo.ph', name: 'Paolo Reyes (Manager)', password: 'Manager123!', role: 'manager', employeeId: null });
  const staff = [
    { no: 'E-001', first: 'Juan', last: 'Dela Cruz', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sch: daySched, lateBias: 0.1, speed: 1.0 },
    { no: 'E-002', first: 'Ana', last: 'Lim', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sch: daySched, lateBias: 0.02, speed: 0.8 },
    { no: 'E-003', first: 'Mark', last: 'Villanueva', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sch: midSched, lateBias: 0.35, speed: 1.3 },
    { no: 'E-004', first: 'Liza', last: 'Garcia', position: 'Head Server', dept: 'Service', pay: 'daily' as const, rate: 800, sch: midSched, lateBias: 0.05, speed: 0.9 },
    { no: 'E-005', first: 'Carlo', last: 'Mendoza', position: 'Line Cook', dept: 'Kitchen', pay: 'daily' as const, rate: 750, sch: daySched, lateBias: 0.15, speed: 1 },
    { no: 'E-006', first: 'Grace', last: 'Torres', position: 'Cashier', dept: 'Front', pay: 'daily' as const, rate: 695, sch: daySched, lateBias: 0.08, speed: 1 },
    { no: 'E-007', first: 'Ramon', last: 'Aquino', position: 'Kitchen Supervisor', dept: 'Kitchen', pay: 'monthly' as const, rate: 28000, sch: daySched, lateBias: 0.05, speed: 1 },
    { no: 'E-008', first: 'Bea', last: 'Navarro', position: 'Restaurant Manager', dept: 'Management', pay: 'monthly' as const, rate: 45000, sch: daySched, lateBias: 0.0, speed: 1 },
    { no: 'E-009', first: 'Jessa', last: 'Ramos', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sch: dayWed, lateBias: 0.12, speed: 1.1 },
    { no: 'E-010', first: 'Kevin', last: 'Bautista', position: 'Dishwasher', dept: 'Kitchen', pay: 'daily' as const, rate: 645, sch: midTue, lateBias: 0.2, speed: 1 },
    { no: 'E-011', first: 'Rica', last: 'Santos', position: 'Prep Cook', dept: 'Kitchen', pay: 'daily' as const, rate: 720, sch: early, lateBias: 0.06, speed: 1 },
    { no: 'E-012', first: 'Noel', last: 'Cruz', position: 'Barista', dept: 'Bar', pay: 'daily' as const, rate: 695, sch: early, lateBias: 0.1, speed: 1 },
    { no: 'E-013', first: 'Mae', last: 'Flores', position: 'Bartender', dept: 'Bar', pay: 'daily' as const, rate: 760, sch: midTue, lateBias: 0.08, speed: 1 },
    { no: 'E-014', first: 'Joy', last: 'Castillo', position: 'Cashier', dept: 'Front', pay: 'daily' as const, rate: 695, sch: midSched, lateBias: 0.05, speed: 1 },
  ];
  const created = nowIso();
  for (const x of staff) {
    s.employees.push({ id: uid(), employeeNo: x.no, firstName: x.first, lastName: x.last, position: x.position, department: x.dept, branchId, scheduleId: x.sch.id, payType: x.pay, rate: x.rate, allowances: x.pay === 'monthly' ? [{ code: 'rice', label: 'Rice subsidy (de minimis)', amount: 1000 }] : [], exemptions: {}, tin: String(Math.floor(rand() * 1e9)), sssNo: `34-${Math.floor(rand() * 1e7)}-${Math.floor(rand() * 9)}`, philhealthNo: null, pagibigNo: null, hireDate: '2025-06-01', active: true, pin: '1234', biometricConsentAt: created, createdAt: created });
  }
  const emps = s.employees;
  s.users.push({ id: uid(), email: 'juan@demo.ph', name: 'Juan Dela Cruz', password: 'Employee123!', role: 'employee', employeeId: emps[0].id });
  for (const e of emps) s.templates.push({ id: uid(), employeeId: e.id, finger: 'R_INDEX', format: 'SIMULATED', template: `SIM:${e.employeeNo}`, quality: 90, createdAt: created });
  const device: Device = { id: uid(), name: 'Front Counter Tablet', driver: 'simulator', active: true, lastSeenAt: null, createdAt: created, token: DEMO_DEVICE_TOKEN, branchId };
  s.devices.push(device);
  const hol: [string, string, Holiday['type']][] = [
    ['2026-01-01', "New Year's Day", 'regular'], ['2026-02-17', 'Chinese New Year', 'special_non_working'], ['2026-04-02', 'Maundy Thursday', 'regular'],
    ['2026-04-03', 'Good Friday', 'regular'], ['2026-04-04', 'Black Saturday', 'special_non_working'], ['2026-04-09', 'Araw ng Kagitingan', 'regular'],
    ['2026-05-01', 'Labor Day', 'regular'], ['2026-06-12', 'Independence Day', 'regular'], ['2026-08-21', 'Ninoy Aquino Day', 'special_non_working'],
    ['2026-08-31', 'National Heroes Day', 'regular'], ['2026-11-01', "All Saints' Day", 'special_non_working'], ['2026-11-02', "All Souls' Day", 'special_non_working'],
    ['2026-11-30', 'Bonifacio Day', 'regular'], ['2026-12-08', 'Feast of the Immaculate Conception', 'special_non_working'], ['2026-12-24', 'Christmas Eve', 'special_non_working'],
    ['2026-12-25', 'Christmas Day', 'regular'], ['2026-12-30', 'Rizal Day', 'regular'], ['2026-12-31', 'Last Day of the Year', 'special_non_working'],
  ];
  for (const [date, n, type] of hol) s.holidays.push({ id: uid(), date, name: n, type });
  s.rules.push(
    { id: uid(), name: 'Late policy', config: { kind: 'late_tiered', tiers: [{ minMinutes: 6, maxMinutes: 15, amount: 25 }, { minMinutes: 16, maxMinutes: 30, amount: 50 }, { minMinutes: 31, maxMinutes: null, amount: 100 }] }, active: true, autoApprove: false, createdAt: created },
    { id: uid(), name: 'Habitual tardiness (5+ per cutoff)', config: { kind: 'late_frequency', threshold: 5, amount: 200 }, active: true, autoApprove: false, createdAt: created },
    { id: uid(), name: 'No time-out', config: { kind: 'missing_timeout', amount: 20 }, active: true, autoApprove: false, createdAt: created },
  );

  // Five weeks of punches and order slips up to yesterday.
  const t0 = DateTime.now().setZone(TZ).startOf('day');
  let serial = 1000;
  const nowDt = DateTime.now().setZone(TZ);
  // Five weeks of history plus today so far (the time clock looks live).
  for (let d = t0.minus({ days: 35 }); d <= t0; d = d.plus({ days: 1 })) {
    staff.forEach((x, i) => {
      const e = emps[i];
      if (x.sch.restDays.includes(d.weekday)) return;
      if (rand() < 0.04) return;
      const [sh, sm] = x.sch.startTime.split(':').map(Number);
      const [eh, em] = x.sch.endTime.split(':').map(Number);
      const late = rand() < x.lateBias ? Math.floor(6 + rand() * 35) : -Math.floor(rand() * 15);
      const inAt = d.set({ hour: sh, minute: sm }).plus({ minutes: late });
      const outAt = d.set({ hour: eh, minute: em }).plus({ minutes: Math.floor(rand() * 75) - 5 });
      if (inAt > nowDt) return;
      s.punches.push({ id: uid(), employeeId: e.id, deviceId: device.id, type: 'in', punchedAt: inAt.toUTC().toISO()!, method: 'fingerprint', matchScore: 120 + Math.floor(rand() * 60), clientUuid: null, voided: false, createdBy: null, reason: null });
      if (outAt < nowDt && rand() > 0.03) s.punches.push({ id: uid(), employeeId: e.id, deviceId: device.id, type: 'out', punchedAt: outAt.toUTC().toISO()!, method: 'fingerprint', matchScore: 120 + Math.floor(rand() * 60), clientUuid: null, voided: false, createdBy: null, reason: null });
      if (x.position.includes('Server')) {
        const n = Math.floor(10 + (rand() * 10) / x.speed);
        for (let k = 0; k < n; k++) {
          const opened = inAt.plus({ minutes: 20 + Math.floor(rand() * 420) });
          if (opened.plus({ minutes: 60 }) > nowDt) continue;
          const serve = Math.max(4, Math.round((8 + rand() * 12) * x.speed));
          const isVoid = rand() < 0.02 * x.speed;
          serial += rand() < 0.01 ? 2 : 1;
          s.slips.push({ id: uid(), branchId, serverEmployeeId: e.id, serialNo: `OS-${String(serial).padStart(6, '0')}`, tableNo: String(1 + Math.floor(rand() * 20)), openedAt: opened.toUTC().toISO()!, servedAt: opened.plus({ minutes: serve }).toUTC().toISO()!, closedAt: opened.plus({ minutes: serve + 25 + Math.floor(rand() * 30) }).toUTC().toISO()!, amount: Math.round((350 + rand() * 2500) / 10) * 10, itemsCount: 1 + Math.floor(rand() * 8), status: isVoid ? 'void' : 'closed', voidReason: isVoid ? pick(['Customer cancelled', 'Wrong order', 'Duplicate']) : null });
        }
      }
    });
  }
  const note = (i: number, category: string, title: string, body: string, rating: number, visible = false) => s.notes.push({ id: uid(), employeeId: emps[i].id, authorId: owner.id, category, title, body, rating, visibleToEmployee: visible, createdAt: t0.minus({ days: 3 + i }).toUTC().toISO()! });
  note(1, 'commendation', 'Great guest feedback', 'Two 5-star reviews mention Ana by name this week.', 2, true);
  note(2, 'warning', 'Repeated tardiness', 'Late 4 times in 2 weeks. Verbal warning given; next is written.', -2);
  note(3, 'coaching', 'Training new servers', 'Liza is mentoring two new hires — keep her on mid shift.', 1);
  note(0, 'general', 'Upsell target', 'Juan reached the dessert upsell target.', 1, true);

  // A finished payroll for the previous cutoff, so payslips and history are populated.
  const ctx: Ctx = { user: owner, device: null, ip: 'seed' };
  const prevEnd = t0.day > 15 ? t0.set({ day: 15 }) : t0.minus({ months: 1 }).endOf('month').startOf('day');
  const prevStart = prevEnd.day === 15 ? prevEnd.set({ day: 1 }) : prevEnd.set({ day: 16 });
  const run: Run = { id: uid(), periodStart: prevStart.toISODate()!, periodEnd: prevEnd.toISODate()!, payDate: prevEnd.plus({ days: 5 }).toISODate()!, frequency: 'semi_monthly', cutoff: prevEnd.day === 15 ? 1 : 2, status: 'draft', createdBy: owner.id, approvedBy: null, approvedAt: null, computedAt: null, branchId: null, notes: null, createdAt: created };
  s.runs.push(run);
  generatePenalties(run.periodStart, run.periodEnd);
  for (const p of s.penalties.filter((x) => x.kind === 'late' && x.amount >= 50)) Object.assign(p, { status: 'approved', decidedBy: owner.id, decidedAt: created, decisionReason: 'Per written late policy' });
  computeRun(ctx, run.id);
  const juanSlip = s.payslips.find((p) => p.runId === run.id && p.employeeId === emps[0].id)!;
  s.lines.push({ id: uid(), payslipId: juanSlip.id, code: 'MANUAL_SEEDCA', label: 'Cash advance', category: 'deduction', quantity: null, rate: null, amount: 500, taxable: false, enabled: true, isManual: true, sortOrder: 500, updatedBy: owner.id, updatedAt: created, editReason: 'CA approved by owner, repay in 1 cutoff' });
  audit(ctx, { entity: 'payslip_line', action: 'add_manual', after: { payslipId: juanSlip.id, runId: run.id, employeeId: emps[0].id, label: 'Cash advance', category: 'deduction', amount: 500 }, reason: 'CA approved by owner, repay in 1 cutoff' });
  computeRun(ctx, run.id, [emps[0].id]);
  run.status = 'approved'; run.approvedBy = owner.id; run.approvedAt = created;
  audit(ctx, { entity: 'payroll_run', entityId: run.id, action: 'approve', before: { status: 'review' }, after: { status: 'approved' } });
  // Pending penalties from the current cutoff for the manager to review.
  generatePenalties(prevEnd.plus({ days: 1 }).toISODate()!, t0.toISODate()!);
  return s;
}
