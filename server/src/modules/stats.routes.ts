import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { parse, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { fighterCards } from '../stats/service.js';

export default async function statsRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  app.get('/api/stats/cards', staff, async (req) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30), employeeId: uuid.optional() }), req.query);
    return fighterCards(userOf(req).tenantId, q.days, q.employeeId);
  });

  /** Admin dashboard: KPIs + 14-day attendance trend. */
  app.get('/api/dashboard', staff, async (req) => {
    const p = userOf(req);
    const tenant = await getTenant(p.tenantId);
    const today = DateTime.now().setZone(tenant.timezone);
    const from = today.minus({ days: 13 }).toISODate()!;
    const { employees, records } = await getDayRecords(p.tenantId, from, today.toISODate()!);
    const trend = [];
    for (let d = DateTime.fromISO(from); d <= today; d = d.plus({ days: 1 })) {
      const date = d.toISODate()!;
      let present = 0, late = 0, absent = 0;
      for (const recs of records.values()) {
        const r = recs.find((x) => x.date === date);
        if (!r) continue;
        if (r.present) present++;
        if (r.lateMinutes > 0) late++;
        if (r.absent) absent++;
      }
      trend.push({ date, present, late, absent });
    }
    const all = [...records.values()].flat();
    const totals = summarize(all);
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.penalties).where(and(eq(schema.penalties.tenantId, p.tenantId), eq(schema.penalties.status, 'pending')));
    const [lastRun] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, p.tenantId)).orderBy(desc(schema.payrollRuns.periodStart)).limit(1);
    const lastRunTotals = lastRun ? (await db.select({ net: sql<number>`coalesce(sum(net),0)::float`, gross: sql<number>`coalesce(sum(gross),0)::float` }).from(schema.payslips).where(eq(schema.payslips.runId, lastRun.id)))[0] : null;
    return {
      activeEmployees: employees.length,
      last14: totals,
      attendanceRate: totals.scheduledDays ? totals.daysPresent / Math.max(totals.scheduledDays, 1) : null,
      pendingPenalties: pending.n,
      lastRun: lastRun ? { ...lastRun, ...lastRunTotals } : null,
      trend,
    };
  });
}
