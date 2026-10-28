import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { UserPrincipal } from '../plugins/auth.js';
import { getDayRecords } from '../attendance/service.js';
import { generatePenalties } from '../penalties/service.js';
import { computePayslip, type LineOverride, type PayLine } from './engine.js';

type Run = typeof schema.payrollRuns.$inferSelect;
type SavedLine = typeof schema.payslipLines.$inferSelect;

export const EDITABLE: Run['status'][] = ['draft', 'review'];

export async function getRun(tenantId: string, runId: string) {
  const [run] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.tenantId, tenantId)));
  if (!run) throw notFound('Payroll run');
  return run;
}

export function assertEditable(run: Run) {
  if (!EDITABLE.includes(run.status)) throw conflict(`Payroll run is ${run.status} — reopen it before editing`);
}

/** Turn previously saved lines into engine overrides + manual lines (so edits survive recompute). */
function overridesFrom(lines: SavedLine[]) {
  const overrides: Record<string, LineOverride> = {};
  const manualLines: PayLine[] = [];
  const meta = new Map<string, Pick<SavedLine, 'updatedBy' | 'updatedAt' | 'editReason'>>();
  for (const l of lines) {
    if (l.updatedBy) meta.set(l.code, { updatedBy: l.updatedBy, updatedAt: l.updatedAt, editReason: l.editReason });
    if (l.code.startsWith('MANUAL_')) {
      manualLines.push({ code: l.code, label: l.label, category: l.category, quantity: l.quantity, rate: l.rate, amount: l.amount, taxable: l.taxable, enabled: l.enabled, isManual: true, sortOrder: l.sortOrder });
      continue;
    }
    const o: LineOverride = {};
    if (l.isManual) { o.amount = l.amount; o.label = l.label; }
    if (!l.enabled) o.enabled = false;
    if (Object.keys(o).length) overrides[l.code] = o;
  }
  return { overrides, manualLines, meta };
}

/** Compute (or re-compute) payslips for a run. Keeps manual edits, regenerates everything else. */
export async function computeRun(actor: UserPrincipal, runId: string, opts: { employeeIds?: string[]; ip?: string } = {}) {
  const run = await getRun(actor.tenantId, runId);
  assertEditable(run);

  // Employees in scope: active (optionally by branch), plus anyone already on the run.
  const existingSlips = await db.select().from(schema.payslips).where(eq(schema.payslips.runId, runId));
  let employeeIds = opts.employeeIds;
  if (!employeeIds) {
    const active = await db.select({ id: schema.employees.id }).from(schema.employees).where(and(
      eq(schema.employees.tenantId, actor.tenantId), eq(schema.employees.active, true),
      run.branchId ? eq(schema.employees.branchId, run.branchId) : undefined,
    ));
    employeeIds = [...new Set([...active.map((e) => e.id), ...existingSlips.map((s) => s.employeeId)])];
  }
  if (!employeeIds.length) return { computed: 0 };

  await generatePenalties(actor.tenantId, run.periodStart, run.periodEnd, employeeIds);
  const { tenant, employees, records } = await getDayRecords(actor.tenantId, run.periodStart, run.periodEnd, employeeIds);
  const penalties = await db.select().from(schema.penalties).where(and(
    eq(schema.penalties.tenantId, actor.tenantId), eq(schema.penalties.status, 'approved'),
    inArray(schema.penalties.employeeId, employeeIds),
    gte(schema.penalties.date, run.periodStart), lte(schema.penalties.date, run.periodEnd),
    or(isNull(schema.penalties.payrollRunId), eq(schema.penalties.payrollRunId, runId)),
  ));

  await db.transaction(async (tx) => {
    for (const emp of employees) {
      const slip = existingSlips.find((s) => s.employeeId === emp.id);
      const saved = slip ? await tx.select().from(schema.payslipLines).where(eq(schema.payslipLines.payslipId, slip.id)) : [];
      const { overrides, manualLines, meta } = overridesFrom(saved);
      const empPenalties = penalties.filter((x) => x.employeeId === emp.id);
      const result = computePayslip({
        employee: { payType: emp.payType, rate: emp.rate, allowances: emp.allowances, exemptions: emp.exemptions },
        days: records.get(emp.id) ?? [],
        settings: tenant.settings.payroll,
        run: { frequency: run.frequency, cutoff: run.cutoff, periodStart: run.periodStart, periodEnd: run.periodEnd },
        penalties: empPenalties.map((x) => ({ id: x.id, date: x.date, amount: x.amount, reason: x.reason, kind: x.kind })),
        overrides,
        manualLines,
      });
      const values = { gross: result.gross, totalDeductions: result.totalDeductions, net: result.net, summary: { ...result.summary, rates: result.rates } };
      const [ps] = slip
        ? await tx.update(schema.payslips).set(values).where(eq(schema.payslips.id, slip.id)).returning()
        : await tx.insert(schema.payslips).values({ ...values, tenantId: actor.tenantId, runId, employeeId: emp.id }).returning();
      await tx.delete(schema.payslipLines).where(eq(schema.payslipLines.payslipId, ps.id));
      if (result.lines.length) {
        await tx.insert(schema.payslipLines).values(result.lines.map((l) => ({
          // Re-use the previous row id per code so line ids stay stable across recomputes.
          id: saved.find((x) => x.code === l.code)?.id,
          ...l, tenantId: actor.tenantId, payslipId: ps.id, ...(meta.get(l.code) ?? {}),
        })));
      }
      if (empPenalties.length) {
        await tx.update(schema.penalties).set({ payrollRunId: runId }).where(inArray(schema.penalties.id, empPenalties.map((x) => x.id)));
      }
    }
    await tx.update(schema.payrollRuns).set({ computedAt: new Date(), status: 'review' }).where(eq(schema.payrollRuns.id, runId));
    if (!opts.employeeIds) await audit(actor, { entity: 'payroll_run', entityId: runId, action: 'compute', after: { employees: employees.length } }, tx, opts.ip);
  });
  return { computed: employees.length };
}

/** Edit an existing line (amount / enabled / label). Reason mandatory; payslip is recomputed so tax & totals follow. */
export async function editLine(actor: UserPrincipal, lineId: string, change: { amount?: number; enabled?: boolean; label?: string }, reason: string, ip?: string) {
  const [line] = await db.select().from(schema.payslipLines).where(and(eq(schema.payslipLines.id, lineId), eq(schema.payslipLines.tenantId, actor.tenantId)));
  if (!line) throw notFound('Payslip line');
  const [slip] = await db.select().from(schema.payslips).where(eq(schema.payslips.id, line.payslipId));
  const run = await getRun(actor.tenantId, slip.runId);
  assertEditable(run);
  if (change.amount === undefined && change.enabled === undefined && change.label === undefined) throw badRequest('Nothing to change');

  const after = {
    ...(change.amount !== undefined ? { amount: change.amount, isManual: true } : {}),
    ...(change.label !== undefined ? { label: change.label, isManual: true } : {}),
    ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
    updatedBy: actor.userId, updatedAt: new Date(), editReason: reason,
  };
  await db.transaction(async (tx) => {
    await tx.update(schema.payslipLines).set(after).where(eq(schema.payslipLines.id, lineId));
    await audit(actor, {
      entity: 'payslip_line', entityId: lineId, action: 'edit',
      before: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, label: line.label, amount: line.amount, enabled: line.enabled },
      after: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, ...change },
      reason,
    }, tx, ip);
  });
  await computeRun(actor, run.id, { employeeIds: [slip.employeeId], ip });
  return { ok: true };
}

/** Restore an auto line to its computed value (removes the override). */
export async function resetLine(actor: UserPrincipal, lineId: string, reason: string, ip?: string) {
  const [line] = await db.select().from(schema.payslipLines).where(and(eq(schema.payslipLines.id, lineId), eq(schema.payslipLines.tenantId, actor.tenantId)));
  if (!line) throw notFound('Payslip line');
  if (line.code.startsWith('MANUAL_')) throw badRequest('Manual lines are removed, not reset');
  const [slip] = await db.select().from(schema.payslips).where(eq(schema.payslips.id, line.payslipId));
  const run = await getRun(actor.tenantId, slip.runId);
  assertEditable(run);
  await db.transaction(async (tx) => {
    await tx.update(schema.payslipLines).set({ isManual: false, enabled: true, updatedBy: actor.userId, updatedAt: new Date(), editReason: reason }).where(eq(schema.payslipLines.id, lineId));
    await audit(actor, { entity: 'payslip_line', entityId: lineId, action: 'reset', before: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, amount: line.amount, enabled: line.enabled }, reason }, tx, ip);
  });
  await computeRun(actor, run.id, { employeeIds: [slip.employeeId], ip });
  return { ok: true };
}

export async function addManualLine(actor: UserPrincipal, payslipId: string, input: { label: string; category: 'earning' | 'deduction'; amount: number; taxable: boolean }, reason: string, ip?: string) {
  const [slip] = await db.select().from(schema.payslips).where(and(eq(schema.payslips.id, payslipId), eq(schema.payslips.tenantId, actor.tenantId)));
  if (!slip) throw notFound('Payslip');
  const run = await getRun(actor.tenantId, slip.runId);
  assertEditable(run);
  const code = `MANUAL_${Date.now().toString(36).toUpperCase()}`;
  await db.transaction(async (tx) => {
    const [l] = await tx.insert(schema.payslipLines).values({
      tenantId: actor.tenantId, payslipId, code, label: input.label, category: input.category, amount: input.amount,
      taxable: input.taxable, isManual: true, enabled: true, quantity: null, rate: null, sortOrder: 500,
      updatedBy: actor.userId, updatedAt: new Date(), editReason: reason,
    }).returning();
    await audit(actor, { entity: 'payslip_line', entityId: l.id, action: 'add_manual', after: { payslipId, runId: run.id, employeeId: slip.employeeId, ...input, code }, reason }, tx, ip);
  });
  await computeRun(actor, run.id, { employeeIds: [slip.employeeId], ip });
  return { ok: true, code };
}

export async function removeManualLine(actor: UserPrincipal, lineId: string, reason: string, ip?: string) {
  const [line] = await db.select().from(schema.payslipLines).where(and(eq(schema.payslipLines.id, lineId), eq(schema.payslipLines.tenantId, actor.tenantId)));
  if (!line) throw notFound('Payslip line');
  if (!line.code.startsWith('MANUAL_')) throw badRequest('Only manual lines can be removed — disable computed lines instead');
  const [slip] = await db.select().from(schema.payslips).where(eq(schema.payslips.id, line.payslipId));
  const run = await getRun(actor.tenantId, slip.runId);
  assertEditable(run);
  await db.transaction(async (tx) => {
    await tx.delete(schema.payslipLines).where(eq(schema.payslipLines.id, lineId));
    await audit(actor, { entity: 'payslip_line', entityId: lineId, action: 'remove_manual', before: { payslipId: slip.id, runId: run.id, employeeId: slip.employeeId, code: line.code, label: line.label, amount: line.amount }, reason }, tx, ip);
  });
  await computeRun(actor, run.id, { employeeIds: [slip.employeeId], ip });
  return { ok: true };
}

const TRANSITIONS: Record<string, { from: Run['status'][]; to: Run['status']; adminOnly: boolean; needsReason: boolean }> = {
  approve: { from: ['review'], to: 'approved', adminOnly: true, needsReason: false },
  reopen: { from: ['approved', 'review'], to: 'draft', adminOnly: true, needsReason: true },
  mark_paid: { from: ['approved'], to: 'paid', adminOnly: true, needsReason: false },
  void: { from: ['draft', 'review', 'approved'], to: 'void', adminOnly: true, needsReason: true },
};

export async function transitionRun(actor: UserPrincipal, runId: string, action: keyof typeof TRANSITIONS, reason?: string, ip?: string) {
  const t = TRANSITIONS[action];
  if (!t) throw badRequest('Unknown action');
  if (t.adminOnly && !['owner', 'admin'].includes(actor.role)) throw badRequest('Only admins can do this');
  if (t.needsReason && (!reason || reason.trim().length < 3)) throw badRequest('A reason is required');
  const run = await getRun(actor.tenantId, runId);
  if (!t.from.includes(run.status)) throw conflict(`Cannot ${action} a run that is ${run.status}`);
  const patch: Partial<Run> = { status: t.to };
  if (action === 'approve') Object.assign(patch, { approvedBy: actor.userId, approvedAt: new Date() });
  if (action === 'reopen') Object.assign(patch, { approvedBy: null, approvedAt: null });
  await db.transaction(async (tx) => {
    await tx.update(schema.payrollRuns).set(patch).where(eq(schema.payrollRuns.id, runId));
    if (action === 'void') await tx.update(schema.penalties).set({ payrollRunId: null }).where(eq(schema.penalties.payrollRunId, runId));
    await audit(actor, { entity: 'payroll_run', entityId: runId, action, before: { status: run.status }, after: { status: t.to }, reason }, tx, ip);
  });
  return { ok: true, status: t.to };
}
