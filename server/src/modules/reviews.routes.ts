import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { employeeCards } from '../stats/service.js';
import { findEmployee } from './employees.routes.js';

const star = z.number().min(0.5).max(5).multipleOf(0.5);
const reviewBody = z.object({
  periodStart: isoDate, periodEnd: isoDate,
  ratings: z.object({
    serviceQuality: star, productKnowledge: star, problemSolving: star, timeManagement: star, adaptability: star, workEthic: star,
    leadership: star, communication: star, reliability: star, professionalism: star, customerOrientation: star, teamwork: star,
  }).partial(),
  strengths: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  weaknesses: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  opportunities: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  threats: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  notes: z.string().trim().max(2000).nullish(),
  assists: z.number().int().min(0).max(10000).default(0),
  employeeOfMonth: z.number().int().min(0).max(100).default(0),
  trainingCompleted: z.number().int().min(0).max(1000).default(0),
  crossTrained: z.number().int().min(0).max(50).default(0),
  skillLevel: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).nullish(),
  promotionReady: z.boolean().default(false),
  managerName: z.string().trim().max(80).nullish(),
});

/** 5-star management reviews and the performance summary behind the Employee card. */
export default async function reviewRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  app.get('/api/employees/:id/reviews', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await findEmployee(p.tenantId, id);
    const rows = await db.select({ r: schema.performanceReviews, reviewer: schema.users.name }).from(schema.performanceReviews)
      .innerJoin(schema.users, eq(schema.users.id, schema.performanceReviews.reviewerId))
      .where(and(eq(schema.performanceReviews.tenantId, p.tenantId), eq(schema.performanceReviews.employeeId, id)))
      .orderBy(desc(schema.performanceReviews.periodEnd));
    return rows.map((x) => ({ ...x.r, reviewerName: x.reviewer }));
  });

  app.post('/api/employees/:id/reviews', staff, async (req, reply) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(reviewBody, req.body);
    await findEmployee(p.tenantId, id);
    const [r] = await db.insert(schema.performanceReviews).values({ ...body, managerName: body.managerName ?? p.name, tenantId: p.tenantId, employeeId: id, reviewerId: p.userId }).returning();
    await audit(p, { entity: 'review', entityId: r.id, action: 'create', after: { employeeId: id, period: [body.periodStart, body.periodEnd] } }, db, req.ip);
    reply.code(201);
    return r;
  });

  app.delete('/api/reviews/:id', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [r] = await db.delete(schema.performanceReviews).where(and(eq(schema.performanceReviews.id, id), eq(schema.performanceReviews.tenantId, p.tenantId))).returning();
    if (!r) throw notFound('Review');
    await audit(p, { entity: 'review', entityId: id, action: 'delete', before: r }, db, req.ip);
    return { ok: true };
  });

  /** Everything the performance summary page shows for one employee and period. */
  app.get('/api/employees/:id/performance', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const tenant = await getTenant(p.tenantId);
    const today = DateTime.now().setZone(tenant.timezone);
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const from = q.from ?? today.minus({ months: 3 }).plus({ days: 1 }).toISODate()!;
    const to = q.to ?? today.toISODate()!;
    const e = await findEmployee(p.tenantId, id);
    const [card] = await employeeCards(p.tenantId, from, to, id);
    const [branch] = e.branchId ? await db.select().from(schema.branches).where(eq(schema.branches.id, e.branchId)) : [];
    const [review] = await db.select().from(schema.performanceReviews)
      .where(and(eq(schema.performanceReviews.tenantId, p.tenantId), eq(schema.performanceReviews.employeeId, id))).orderBy(desc(schema.performanceReviews.periodEnd)).limit(1);
    return {
      period: { from, to },
      employee: { id: e.id, employeeNo: e.employeeNo, name: `${e.firstName} ${e.lastName}`.trim(), position: e.position, department: e.department, hireDate: e.hireDate, active: e.active, photoUrl: e.photoUrl, location: branch?.name ?? tenant.name, payType: e.payType },
      card: card ?? null,
      review: review ?? null,
    };
  });
}
