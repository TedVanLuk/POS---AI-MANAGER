import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { isoDate, parse, reason, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { generatePenalties } from '../penalties/service.js';
import { findEmployee } from './employees.routes.js';

const ruleConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('late_tiered'), tiers: z.array(z.object({ minMinutes: z.number().int().min(1), maxMinutes: z.number().int().nullable(), amount: z.number().min(0) })).min(1) }),
  z.object({ kind: z.literal('late_frequency'), threshold: z.number().int().min(1), amount: z.number().min(0) }),
  z.object({ kind: z.literal('absence'), amount: z.number().min(0) }),
  z.object({ kind: z.literal('missing_timeout'), amount: z.number().min(0) }),
]);

export default async function penaltyRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  app.get('/api/penalty-rules', staff, async (req) =>
    db.select().from(schema.penaltyRules).where(eq(schema.penaltyRules.tenantId, userOf(req).tenantId)).orderBy(schema.penaltyRules.createdAt));

  app.post('/api/penalty-rules', admin, async (req, reply) => {
    const p = userOf(req);
    const body = parse(z.object({ name: z.string().min(1), config: ruleConfig, active: z.boolean().default(true), autoApprove: z.boolean().default(false) }), req.body);
    const [r] = await db.insert(schema.penaltyRules).values({ ...body, tenantId: p.tenantId }).returning();
    await audit(p, { entity: 'penalty_rule', entityId: r.id, action: 'create', after: r }, db, req.ip);
    reply.code(201);
    return r;
  });

  app.patch('/api/penalty-rules/:id', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ name: z.string().min(1), config: ruleConfig, active: z.boolean(), autoApprove: z.boolean() }).partial(), req.body);
    const [before] = await db.select().from(schema.penaltyRules).where(and(eq(schema.penaltyRules.id, id), eq(schema.penaltyRules.tenantId, p.tenantId)));
    if (!before) throw notFound('Rule');
    const [r] = await db.update(schema.penaltyRules).set(body).where(eq(schema.penaltyRules.id, id)).returning();
    await audit(p, { entity: 'penalty_rule', entityId: id, action: 'update', before, after: r }, db, req.ip);
    return r;
  });

  app.get('/api/penalties', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ status: z.enum(['pending', 'approved', 'waived']).optional(), employeeId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const rows = await db.select({ penalty: schema.penalties, firstName: schema.employees.firstName, lastName: schema.employees.lastName, employeeNo: schema.employees.employeeNo, decidedByName: schema.users.name })
      .from(schema.penalties)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.penalties.employeeId))
      .leftJoin(schema.users, eq(schema.users.id, schema.penalties.decidedBy))
      .where(and(
        eq(schema.penalties.tenantId, p.tenantId),
        q.status ? eq(schema.penalties.status, q.status) : undefined,
        q.employeeId ? eq(schema.penalties.employeeId, q.employeeId) : undefined,
        q.from ? gte(schema.penalties.date, q.from) : undefined,
        q.to ? lte(schema.penalties.date, q.to) : undefined,
      ))
      .orderBy(desc(schema.penalties.date)).limit(500);
    return rows.map((r) => ({ ...r.penalty, employeeName: `${r.firstName} ${r.lastName}`, employeeNo: r.employeeNo, decidedByName: r.decidedByName }));
  });

  /** Run the rules engine over a date range (also runs automatically on payroll compute). */
  app.post('/api/penalties/generate', staff, async (req) => {
    const p = userOf(req);
    const body = parse(z.object({ from: isoDate, to: isoDate }), req.body);
    const r = await generatePenalties(p.tenantId, body.from, body.to);
    await audit(p, { entity: 'penalty', action: 'generate', after: { ...body, ...r } }, db, req.ip);
    return r;
  });

  /** Manual disciplinary deduction (management decision). */
  app.post('/api/penalties', staff, async (req, reply) => {
    const p = userOf(req);
    const body = parse(z.object({ employeeId: uuid, date: isoDate, kind: z.string().min(1).default('disciplinary'), amount: z.number().positive(), reason }), req.body);
    await findEmployee(p.tenantId, body.employeeId);
    const [pen] = await db.insert(schema.penalties).values({
      tenantId: p.tenantId, employeeId: body.employeeId, date: body.date, kind: body.kind, amount: body.amount, reason: body.reason,
      status: 'pending', issuedBy: p.userId,
    }).returning();
    await audit(p, { entity: 'penalty', entityId: pen.id, action: 'create', after: pen, reason: body.reason }, db, req.ip);
    reply.code(201);
    return pen;
  });

  app.post('/api/penalties/:id/decide', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ decision: z.enum(['approved', 'waived']), reason: z.string().trim().max(500).optional(), amount: z.number().positive().optional() }), req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.penalties).where(and(eq(schema.penalties.id, id), eq(schema.penalties.tenantId, p.tenantId)));
      if (!before) throw notFound('Penalty');
      if (before.payrollRunId) {
        const [run] = await tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, before.payrollRunId));
        if (run && ['approved', 'paid'].includes(run.status)) throw conflict('Penalty is already in an approved payroll run');
      }
      if (body.decision === 'waived' && (!body.reason || body.reason.length < 3)) throw conflict('A reason is required to waive a penalty');
      const [after] = await tx.update(schema.penalties).set({
        status: body.decision, amount: body.amount ?? before.amount, decidedBy: p.userId, decidedAt: new Date(), decisionReason: body.reason ?? null,
        payrollRunId: body.decision === 'waived' ? null : before.payrollRunId,
      }).where(eq(schema.penalties.id, id)).returning();
      await audit(p, { entity: 'penalty', entityId: id, action: body.decision, before, after, reason: body.reason }, tx, req.ip);
      return after;
    });
  });
}
