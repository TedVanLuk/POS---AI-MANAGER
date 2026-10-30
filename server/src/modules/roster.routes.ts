import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { deriveRates } from '../payroll/engine.js';
import { rosterWeek } from '../stats/roster.js';

const code = z.string().trim().max(16);

/** Weekly staff schedule (roster): usual weeks, per-week changes, totals and estimated payroll. */
export default async function rosterRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  app.get('/api/roster/week', staff, async (req) => {
    const p = userOf(req);
    const tenant = await getTenant(p.tenantId);
    const q = parse(z.object({ start: isoDate.optional() }), req.query);
    const start = DateTime.fromISO(q.start ?? DateTime.now().setZone(tenant.timezone).toISODate()!).startOf('week');
    const end = start.plus({ days: 6 });
    const emps = await db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.active, true)));
    const entries = emps.length ? await db.select().from(schema.rosterEntries).where(and(
      eq(schema.rosterEntries.tenantId, p.tenantId), gte(schema.rosterEntries.date, start.toISODate()!), lte(schema.rosterEntries.date, end.toISODate()!),
    )) : [];
    return rosterWeek({
      employees: emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), department: e.department, position: e.position, photoUrl: e.photoUrl, weekPattern: e.weekPattern, dailyRate: deriveRates(e, tenant.settings.payroll).daily })),
      entries: entries.map((e) => ({ employeeId: e.employeeId, date: e.date, code: e.code })),
      departments: tenant.settings.departments ?? [],
      weekStart: start.toISODate()!,
    });
  });

  /** Change roster cells. `scope: "week"` changes only that date; `"always"` changes the person's usual week. */
  app.put('/api/roster/cells', staff, async (req) => {
    const p = userOf(req);
    const body = parse(z.object({
      scope: z.enum(['week', 'always']).default('week'),
      changes: z.array(z.object({ employeeId: uuid, date: isoDate, code })).min(1).max(500),
    }), req.body);
    const ids = [...new Set(body.changes.map((c) => c.employeeId))];
    const emps = await db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), inArray(schema.employees.id, ids)));
    if (emps.length !== ids.length) throw badRequest('Unknown employee in changes');
    await db.transaction(async (tx) => {
      for (const c of body.changes) {
        if (body.scope === 'always') {
          const e = emps.find((x) => x.id === c.employeeId)!;
          const week = Array.from({ length: 7 }, (_, i) => e.weekPattern[i] ?? '');
          week[DateTime.fromISO(c.date).weekday - 1] = c.code;
          e.weekPattern = week;
          await tx.update(schema.employees).set({ weekPattern: week }).where(eq(schema.employees.id, e.id));
          await tx.delete(schema.rosterEntries).where(and(eq(schema.rosterEntries.employeeId, e.id), eq(schema.rosterEntries.date, c.date)));
        } else {
          await tx.insert(schema.rosterEntries).values({ tenantId: p.tenantId, employeeId: c.employeeId, date: c.date, code: c.code, updatedBy: p.userId })
            .onConflictDoUpdate({ target: [schema.rosterEntries.employeeId, schema.rosterEntries.date], set: { code: c.code, updatedBy: p.userId, updatedAt: new Date() } });
        }
      }
      await audit(p, { entity: 'roster', action: body.scope === 'always' ? 'update_usual_week' : 'update_week', after: body.changes }, tx, req.ip);
    });
    return { ok: true, changed: body.changes.length };
  });
}
