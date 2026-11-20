import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { deriveRates } from '../payroll/engine.js';
import { resolveRoles, type RoleOverride } from '../policy/jobs.js';
import { analyse, mgmtOverview, operationalFor, SCALE, scheduledHoursFor, type ReviewInput } from '../mgmt/sevenstep.js';
import { round2 } from '../lib/money.js';

const num = z.number().min(0).max(10_000_000).nullable();
const reviewBody = z.object({
  employeeId: uuid, date: isoDate,
  reviewerRoleKey: z.string().max(80).nullable().optional(), reviewerName: z.string().trim().min(1).max(120),
  input: z.object({
    tasksAssigned: num, tasksCompleted: num, quantityScore: z.enum(SCALE).nullable(), qualityScore: z.enum(SCALE).nullable(), qualityNote: z.string().trim().max(500).nullish(),
    scheduledHours: z.number().min(0).max(24).nullable(), productiveHours: z.number().min(0).max(24).nullable(), hoursNote: z.string().trim().max(500).nullish(),
    operational: z.array(z.object({ name: z.string().trim().min(1).max(80), unit: z.string().max(8).optional(), plan: num, fact: num, lowerIsBetter: z.boolean().optional() })).max(12),
    revenuePlan: num, revenueFact: num, cost: num, effort: z.enum(['hard', 'lazy']).nullish(), improving: z.boolean().nullish(),
  }),
  category: z.number().int().min(1).max(5).optional(),
  result: z.string().trim().max(1000).default(''), analysis: z.string().trim().max(1000).default(''), action: z.string().trim().min(3).max(1500),
});

/** 7-Step Management System: daily reviews by heads of department and supervisors. */
export default async function mgmtRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  const roles = async (tenantId: string) => {
    const rows = await db.select().from(schema.policyDocs).where(eq(schema.policyDocs.tenantId, tenantId));
    return resolveRoles(Object.fromEntries(rows.map((r) => [r.key, r.content as RoleOverride])));
  };
  const history = async (tenantId: string, employeeId: string, before: string) =>
    (await db.select().from(schema.mgmtReviews).where(and(eq(schema.mgmtReviews.tenantId, tenantId), eq(schema.mgmtReviews.employeeId, employeeId), lt(schema.mgmtReviews.date, before)))
      .orderBy(desc(schema.mgmtReviews.date)).limit(10))
      .map((r) => ({ id: r.id, date: r.date, category: r.category, resultsIndex: r.resultsIndex, reviewerName: r.reviewerName, action: r.action }));

  /** Everything the system already knows for steps 3–5 on that day, plus who should review. */
  app.get('/api/mgmt/prefill', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ employeeId: uuid, date: isoDate }), req.query);
    const t = await getTenant(p.tenantId);
    const [e] = await db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.id, q.employeeId)));
    if (!e) throw notFound('Employee');
    const dep = (t.settings.departments ?? []).find((d) => d.name === e.department);
    const { records } = await getDayRecords(p.tenantId, q.date, q.date, [e.id]);
    const day = records.get(e.id)?.[0];
    const daily = deriveRates(e, t.settings.payroll).daily;
    const from28 = DateTime.fromISO(q.date).minus({ days: 28 }).toISODate()!;
    const stats = await db.select().from(schema.serverStats).where(and(eq(schema.serverStats.employeeId, e.id), gte(schema.serverStats.date, from28), lte(schema.serverStats.date, q.date)));
    const slips = await db.select().from(schema.orderSlips).where(and(eq(schema.orderSlips.tenantId, p.tenantId), eq(schema.orderSlips.serverEmployeeId, e.id), eq(schema.orderSlips.status, 'closed'),
      gte(schema.orderSlips.openedAt, DateTime.fromISO(from28, { zone: t.timezone }).toJSDate()), lt(schema.orderSlips.openedAt, DateTime.fromISO(q.date, { zone: t.timezone }).plus({ days: 1, hours: 8 }).toJSDate())));
    const slipDay = (d: Date) => DateTime.fromJSDate(d, { zone: t.timezone }).minus({ hours: 8 }).toISODate()!;
    const revenueByDay = new Map<string, number>();
    for (const s of slips) revenueByDay.set(slipDay(s.openedAt), (revenueByDay.get(slipDay(s.openedAt)) ?? 0) + s.amount);
    const pastRevenue = [...revenueByDay].filter(([d]) => d < q.date).map(([, v]) => v);
    const today = stats.find((s) => s.date === q.date);
    const all = await roles(p.tenantId);
    const staffRole = all.find((r) => r.key === `staff:${e.department}`);
    const reviewer = staffRole?.reportsTo ? all.find((r) => r.key === staffRole.reportsTo) : undefined;
    return {
      employee: { id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), department: e.department, position: e.position, photoUrl: e.photoUrl, dailyRate: round2(daily) },
      attendance: day ? { scheduled: day.scheduled, present: day.present, firstIn: day.firstIn, lastOut: day.lastOut, lateMinutes: day.lateMinutes, workedHours: round2(day.workedMinutes / 60) } : null,
      prefill: {
        scheduledHours: day && !day.scheduled && !day.present ? 0 : scheduledHoursFor(dep?.shiftStart, dep?.shiftEnd),
        productiveHours: day ? Math.round((day.workedMinutes / 60) * 10) / 10 : null,
        operational: operationalFor(e.department, { today: today ?? null, history: stats.filter((s) => s.date < q.date && s.orders + s.lds + s.salesComms > 0) }),
        revenuePlan: pastRevenue.length ? Math.round(pastRevenue.reduce((a, b) => a + b, 0) / pastRevenue.length) : null,
        revenueFact: revenueByDay.get(q.date) ?? (e.department === 'Servers' ? 0 : null),
        cost: day?.present ? round2(daily) : 0,
      },
      reviewer: reviewer ? { key: reviewer.key, title: reviewer.title, holder: reviewer.holder } : null,
      reviewers: all.filter((r) => r.tier !== 'staff' && r.tier !== 'team').map((r) => ({ key: r.key, title: r.title, holder: r.holder })),
      history: await history(p.tenantId, e.id, q.date),
    };
  });

  app.post('/api/mgmt/reviews', staff, async (req) => {
    const p = userOf(req);
    const b = parse(reviewBody, req.body);
    const [e] = await db.select({ id: schema.employees.id }).from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.id, b.employeeId)));
    if (!e) throw notFound('Employee');
    const a = analyse(b.input as ReviewInput, await history(p.tenantId, b.employeeId, b.date));
    const category = b.category ?? a.suggestedCategory;
    if (!category) throw badRequest('Score the quality or enter plan vs fact, and choose a category (step 6)');
    const [row] = await db.insert(schema.mgmtReviews).values({
      tenantId: p.tenantId, employeeId: b.employeeId, date: b.date, reviewerRoleKey: b.reviewerRoleKey ?? null, reviewerName: b.reviewerName,
      input: b.input as ReviewInput, category, suggestedCategory: a.suggestedCategory, resultsIndex: a.resultsIndex, result: b.result, analysis: b.analysis, action: b.action, createdBy: p.userId,
    }).returning();
    await audit(p, { entity: 'mgmt_review', entityId: row.id, action: 'create', after: { employeeId: b.employeeId, date: b.date, category, suggested: a.suggestedCategory } }, db, req.ip);
    return { id: row.id, category, analysis: a };
  });

  const list = async (tenantId: string, f: { from?: string; to?: string; employeeId?: string }) => {
    const rows = await db.select({ r: schema.mgmtReviews, e: schema.employees }).from(schema.mgmtReviews)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.mgmtReviews.employeeId))
      .where(and(eq(schema.mgmtReviews.tenantId, tenantId), f.from ? gte(schema.mgmtReviews.date, f.from) : undefined, f.to ? lte(schema.mgmtReviews.date, f.to) : undefined, f.employeeId ? eq(schema.mgmtReviews.employeeId, f.employeeId) : undefined))
      .orderBy(desc(schema.mgmtReviews.date), desc(schema.mgmtReviews.createdAt));
    return rows.map(({ r, e }) => ({ ...r, employeeName: `${e.firstName} ${e.lastName}`.trim(), department: e.department, position: e.position, photoUrl: e.photoUrl }));
  };

  app.get('/api/mgmt/reviews', staff, async (req) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), employeeId: uuid.optional() }), req.query);
    return (await list(userOf(req).tenantId, q)).map(({ input: _i, ...r }) => r);
  });

  app.get('/api/mgmt/reviews/:id', staff, async (req) => {
    const p = userOf(req);
    const r = (await list(p.tenantId, {})).find((x) => x.id === (req.params as { id: string }).id);
    if (!r) throw notFound('Review');
    return { ...r, analysisData: analyse(r.input, await history(p.tenantId, r.employeeId, r.date)) };
  });

  app.delete('/api/mgmt/reviews/:id', admin, async (req) => {
    const p = userOf(req);
    const id = (req.params as { id: string }).id;
    const [r] = await db.delete(schema.mgmtReviews).where(and(eq(schema.mgmtReviews.tenantId, p.tenantId), eq(schema.mgmtReviews.id, id))).returning();
    if (!r) throw notFound('Review');
    await audit(p, { entity: 'mgmt_review', entityId: id, action: 'delete', before: { employeeId: r.employeeId, date: r.date, category: r.category } }, db, req.ip);
    return { ok: true };
  });

  /** Control view: who was reviewed, latest category per person, per department and per reviewer. */
  app.get('/api/mgmt/overview', staff, async (req) => {
    const p = userOf(req);
    const t = await getTenant(p.tenantId);
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const to = q.to ?? DateTime.now().setZone(t.timezone).toISODate()!;
    const from = q.from ?? DateTime.fromISO(to).minus({ days: 6 }).toISODate()!;
    const emps = await db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.active, true)));
    const recent = await list(p.tenantId, { from: DateTime.fromISO(to).minus({ days: 30 }).toISODate()!, to });
    const all = await roles(p.tenantId);
    return mgmtOverview({ emps: emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), department: e.department })), reviews: recent, roles: all, from, to });
  });

}
