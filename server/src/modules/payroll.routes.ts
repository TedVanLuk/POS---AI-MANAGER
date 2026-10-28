import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { isoDate, parse, reason, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { addManualLine, computeRun, editLine, getRun, removeManualLine, resetLine, transitionRun } from '../payroll/service.js';

export default async function payrollRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  app.get('/api/payroll/runs', staff, async (req) => {
    const p = userOf(req);
    return db.select({
      run: schema.payrollRuns,
      employees: sql<number>`(select count(*)::int from payslips s where s.run_id = ${schema.payrollRuns.id})`,
      gross: sql<number>`(select coalesce(sum(gross),0)::float from payslips s where s.run_id = ${schema.payrollRuns.id})`,
      net: sql<number>`(select coalesce(sum(net),0)::float from payslips s where s.run_id = ${schema.payrollRuns.id})`,
    }).from(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, p.tenantId))
      .orderBy(desc(schema.payrollRuns.periodStart))
      .then((rows) => rows.map((r) => ({ ...r.run, employees: r.employees, gross: r.gross, net: r.net })));
  });

  app.post('/api/payroll/runs', admin, async (req, reply) => {
    const p = userOf(req);
    const tenant = await getTenant(p.tenantId);
    const body = parse(z.object({
      periodStart: isoDate, periodEnd: isoDate, payDate: isoDate.nullish(), branchId: uuid.nullish(),
      frequency: z.enum(['semi_monthly', 'monthly', 'weekly']).optional(), cutoff: z.number().int().min(1).max(2).optional(), notes: z.string().nullish(),
    }), req.body);
    if (body.periodEnd < body.periodStart) throw badRequest('Period end is before period start');
    const frequency = body.frequency ?? tenant.settings.payroll.frequency;
    const cutoff = body.cutoff ?? (Number(body.periodStart.slice(8, 10)) > 15 ? 2 : 1);
    const [run] = await db.insert(schema.payrollRuns).values({ ...body, frequency, cutoff, tenantId: p.tenantId, createdBy: p.userId }).returning();
    await audit(p, { entity: 'payroll_run', entityId: run.id, action: 'create', after: run }, db, req.ip);
    reply.code(201);
    return run;
  });

  app.get('/api/payroll/runs/:id', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const run = await getRun(p.tenantId, id);
    const slips = await db.select({ slip: schema.payslips, firstName: schema.employees.firstName, lastName: schema.employees.lastName, employeeNo: schema.employees.employeeNo, position: schema.employees.position })
      .from(schema.payslips).innerJoin(schema.employees, eq(schema.employees.id, schema.payslips.employeeId))
      .where(eq(schema.payslips.runId, id)).orderBy(asc(schema.employees.lastName));
    const lines = slips.length ? await db.select({ line: schema.payslipLines, editorName: schema.users.name }).from(schema.payslipLines)
      .leftJoin(schema.users, eq(schema.users.id, schema.payslipLines.updatedBy))
      .where(inArray(schema.payslipLines.payslipId, slips.map((s) => s.slip.id)))
      .orderBy(asc(schema.payslipLines.sortOrder)) : [];
    const [creator] = run.createdBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, run.createdBy)) : [];
    const [approver] = run.approvedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, run.approvedBy)) : [];
    const payslips = slips.map((s) => ({
      ...s.slip,
      employee: { id: s.slip.employeeId, name: `${s.firstName} ${s.lastName}`, employeeNo: s.employeeNo, position: s.position },
      lines: lines.filter((l) => l.line.payslipId === s.slip.id).map((l) => ({ ...l.line, editorName: l.editorName })),
    }));
    const totals = payslips.reduce((t, s) => ({
      gross: t.gross + s.gross, deductions: t.deductions + s.totalDeductions, net: t.net + s.net,
      employer: t.employer + s.lines.filter((l) => l.category === 'employer' && l.enabled).reduce((a, l) => a + l.amount, 0),
    }), { gross: 0, deductions: 0, net: 0, employer: 0 });
    return { ...run, createdByName: creator?.name ?? null, approvedByName: approver?.name ?? null, totals, payslips };
  });

  app.post('/api/payroll/runs/:id/compute', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return computeRun(p, id, { ip: req.ip });
  });

  app.post('/api/payroll/runs/:id/:action', admin, async (req) => {
    const p = userOf(req);
    const { id, action } = parse(z.object({ id: uuid, action: z.enum(['approve', 'reopen', 'mark_paid', 'void']) }), req.params);
    const body = parse(z.object({ reason: z.string().optional() }).default({}), req.body ?? {});
    return transitionRun(p, id, action, body.reason, req.ip);
  });

  /** Edit one payslip line: change amount, switch it off/on, or relabel. Reason required. */
  app.patch('/api/payroll/lines/:id', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ amount: z.number().min(0).optional(), enabled: z.boolean().optional(), label: z.string().min(1).optional(), reason }), req.body);
    const { reason: why, ...change } = body;
    return editLine(p, id, change, why, req.ip);
  });

  app.post('/api/payroll/lines/:id/reset', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ reason }), req.body);
    return resetLine(p, id, body.reason, req.ip);
  });

  app.delete('/api/payroll/lines/:id', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ reason }), req.body);
    return removeManualLine(p, id, body.reason, req.ip);
  });

  app.post('/api/payroll/payslips/:id/lines', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ label: z.string().min(1), category: z.enum(['earning', 'deduction']), amount: z.number().positive(), taxable: z.boolean().default(false), reason }), req.body);
    const { reason: why, ...input } = body;
    return addManualLine(p, id, input, why, req.ip);
  });

  /** Edit history for a whole run (payroll-line edits + status changes). */
  app.get('/api/payroll/runs/:id/audit', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await getRun(p.tenantId, id);
    const rows = await db.select({ log: schema.auditLogs, actorName: schema.users.name }).from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
      .where(and(eq(schema.auditLogs.tenantId, p.tenantId), sql`(${schema.auditLogs.entityId} = ${id} or ${schema.auditLogs.before}->>'runId' = ${id} or ${schema.auditLogs.after}->>'runId' = ${id})`))
      .orderBy(desc(schema.auditLogs.createdAt));
    return rows.map((r) => ({ ...r.log, actorName: r.actorName }));
  });
}
