import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { forbidden } from '../lib/errors.js';
import { requireUser, userOf } from '../plugins/auth.js';
import { weekSummary } from '../attendance/service.js';
import { fighterCards } from '../stats/service.js';

/** Employee self-service: own week, lates, approved payslips, own card and shared notes. */
export default async function meRoutes(app: FastifyInstance) {
  const any = { preHandler: requireUser(['owner', 'admin', 'manager', 'employee']) };
  const me = (req: Parameters<typeof userOf>[0]) => {
    const p = userOf(req);
    if (!p.employeeId) throw forbidden('This login is not linked to an employee');
    return { ...p, employeeId: p.employeeId };
  };

  app.get('/api/me/week', any, async (req) => {
    const p = me(req);
    return weekSummary(p.tenantId, p.employeeId);
  });

  app.get('/api/me/card', any, async (req) => {
    const p = me(req);
    const [card] = await fighterCards(p.tenantId, 30, p.employeeId);
    return card ?? null;
  });

  app.get('/api/me/payslips', any, async (req) => {
    const p = me(req);
    const slips = await db.select({ slip: schema.payslips, run: schema.payrollRuns }).from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .where(and(eq(schema.payslips.employeeId, p.employeeId), inArray(schema.payrollRuns.status, ['approved', 'paid'])))
      .orderBy(desc(schema.payrollRuns.periodStart)).limit(24);
    const lines = slips.length ? await db.select().from(schema.payslipLines)
      .where(and(inArray(schema.payslipLines.payslipId, slips.map((s) => s.slip.id)), eq(schema.payslipLines.enabled, true)))
      .orderBy(asc(schema.payslipLines.sortOrder)) : [];
    return slips.map((s) => ({
      id: s.slip.id, periodStart: s.run.periodStart, periodEnd: s.run.periodEnd, payDate: s.run.payDate, status: s.run.status,
      gross: s.slip.gross, totalDeductions: s.slip.totalDeductions, net: s.slip.net,
      lines: lines.filter((l) => l.payslipId === s.slip.id && l.category !== 'employer')
        .map(({ code, label, category, quantity, rate, amount }) => ({ code, label, category, quantity, rate, amount })),
    }));
  });

  app.get('/api/me/notes', any, async (req) => {
    const p = me(req);
    return db.select({ id: schema.managementNotes.id, category: schema.managementNotes.category, title: schema.managementNotes.title, body: schema.managementNotes.body, createdAt: schema.managementNotes.createdAt })
      .from(schema.managementNotes)
      .where(and(eq(schema.managementNotes.employeeId, p.employeeId), eq(schema.managementNotes.visibleToEmployee, true)))
      .orderBy(desc(schema.managementNotes.createdAt));
  });
}
