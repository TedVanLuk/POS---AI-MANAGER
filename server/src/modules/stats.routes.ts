import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { parse, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { fighterCards, serialGaps } from '../stats/service.js';
import { currentCutoff, dailyTrend, overtimeLeaders } from '../stats/dashboard.js';

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
    const todayIso = today.toISODate()!;
    const from = today.minus({ days: 13 }).toISODate()!;
    const cutoff = currentCutoff(todayIso, tenant.settings.payroll.frequency);
    const rangeStart = from < cutoff.start ? from : cutoff.start;
    const { employees, records } = await getDayRecords(p.tenantId, rangeStart, todayIso);
    const trend = dailyTrend(records, from, todayIso);
    const last14 = new Map([...records].map(([id, days]) => [id, days.filter((d) => d.date >= from)]));
    const inCutoff = new Map([...records].map(([id, days]) => [id, days.filter((d) => d.date >= cutoff.start)]));
    const totals = summarize([...last14.values()].flat());
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.penalties).where(and(eq(schema.penalties.tenantId, p.tenantId), eq(schema.penalties.status, 'pending')));
    const [lastRun] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, p.tenantId)).orderBy(desc(schema.payrollRuns.periodStart)).limit(1);
    const lastRunTotals = lastRun ? (await db.select({ net: sql<number>`coalesce(sum(net),0)::float`, gross: sql<number>`coalesce(sum(gross),0)::float` }).from(schema.payslips).where(eq(schema.payslips.runId, lastRun.id)))[0] : null;
    const [cutoffRun] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.tenantId, p.tenantId), eq(schema.payrollRuns.periodStart, cutoff.start)));
    const enrolled = await db.select({ employeeId: schema.fingerprintTemplates.employeeId }).from(schema.fingerprintTemplates).where(eq(schema.fingerprintTemplates.tenantId, p.tenantId));
    const gaps = await serialGaps(p.tenantId, from, todayIso);
    const week = today.minus({ days: 6 }).toISODate()!;
    return {
      activeEmployees: employees.length,
      last14: totals,
      attendanceRate: totals.scheduledDays ? totals.daysPresent / Math.max(totals.scheduledDays, 1) : null,
      pendingPenalties: pending.n,
      lastRun: lastRun ? { ...lastRun, ...lastRunTotals } : null,
      trend,
      cutoff: { ...cutoff, run: cutoffRun ? { id: cutoffRun.id, status: cutoffRun.status } : null },
      overtime: overtimeLeaders(employees, inCutoff, tenant.settings.payroll),
      alerts: {
        pendingPenalties: pending.n,
        missingTimeouts: [...records.values()].flat().filter((d) => d.date >= week && d.missingOut).length,
        missingSerials: gaps.reduce((a, g) => a + g.missing.length, 0),
        notEnrolled: employees.filter((e) => !enrolled.some((x) => x.employeeId === e.id)).length,
      },
    };
  });
}
