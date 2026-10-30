import type { FastifyInstance } from 'fastify';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { isoDate, parse } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { tablesFor } from '../payroll/statutory-ph.js';
import { weeklyPlan } from '../stats/workforce.js';

/** Schedules & workforce planning: weekly roster, head-count per department and labor cost. */
export default async function workforceRoutes(app: FastifyInstance) {
  app.get('/api/workforce/week', { preHandler: requireUser(STAFF_ROLES) }, async (req) => {
    const p = userOf(req);
    const tenant = await getTenant(p.tenantId);
    const q = parse(z.object({ start: isoDate.optional() }), req.query);
    const start = DateTime.fromISO(q.start ?? DateTime.now().setZone(tenant.timezone).toISODate()!).startOf('week');
    const end = start.plus({ days: 6 });
    const [emps, schedules, holidays] = await Promise.all([
      db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.active, true))),
      db.select().from(schema.workSchedules).where(eq(schema.workSchedules.tenantId, p.tenantId)),
      db.select().from(schema.holidays).where(and(eq(schema.holidays.tenantId, p.tenantId), gte(schema.holidays.date, start.toISODate()!), lte(schema.holidays.date, end.toISODate()!))),
    ]);
    return weeklyPlan(
      emps.map((e) => {
        const sch = schedules.find((x) => x.id === e.scheduleId);
        return { ...e, schedule: sch ? { name: sch.name, startTime: sch.startTime, endTime: sch.endTime, restDays: sch.restDays } : null };
      }),
      start.toISODate()!,
      holidays.map((h) => ({ date: h.date, type: h.type, name: h.name })),
      tenant.settings.payroll,
      tablesFor(start.toISODate()!),
    );
  });
}
