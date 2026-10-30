import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { monthWeeks, rankMetric, trackerTotals, TRACKER_METRICS } from '../stats/tracker.js';

/** Servers tracker (Orders, Sales Comms., LD's, PO) — the departments that sell on the floor. */
const TRACKED_DEPARTMENTS = ['Servers', 'Supervisors'];

export default async function trackerRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  app.get('/api/tracker', staff, async (req) => {
    const p = userOf(req);
    const tenant = await getTenant(p.tenantId);
    const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
    const month = q.month ?? DateTime.now().setZone(tenant.timezone).toFormat('yyyy-LL');
    const weeks = monthWeeks(month);
    const from = weeks[0].start, to = weeks[weeks.length - 1].end;
    const people = await db.select().from(schema.employees).where(and(
      eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.active, true),
      or(inArray(schema.employees.department, TRACKED_DEPARTMENTS)),
    ));
    const ids = people.map((e) => e.id);
    const stats = ids.length ? await db.select().from(schema.serverStats).where(and(eq(schema.serverStats.tenantId, p.tenantId), inArray(schema.serverStats.employeeId, ids), gte(schema.serverStats.date, from), lte(schema.serverStats.date, to))) : [];
    const pens = ids.length ? await db.select().from(schema.penalties).where(and(eq(schema.penalties.tenantId, p.tenantId), eq(schema.penalties.status, 'approved'), inArray(schema.penalties.employeeId, ids), gte(schema.penalties.date, from), lte(schema.penalties.date, to))) : [];
    const { records } = ids.length ? await getDayRecords(p.tenantId, from, to, ids) : { records: new Map() };
    const roster = people
      .sort((a, b) => (a.department === b.department ? 0 : a.department === 'Servers' ? -1 : 1))
      .map((e) => ({ employeeId: e.id, name: `${e.firstName} ${e.lastName}`.trim(), position: e.position }));
    const rows = stats.map((s) => ({ employeeId: s.employeeId, date: s.date, orders: s.orders, salesComms: s.salesComms, lds: s.lds, po: s.po }));
    return {
      month, people: roster, stats: rows,
      weeks: weeks.map((w) => {
        const daysWorked = new Map(ids.map((id) => [id, summarize((records.get(id) ?? []).filter((d: { date: string }) => d.date >= w.start && d.date <= w.end)).daysPresent]));
        const penalties = new Map(ids.map((id) => [id, pens.filter((x) => x.employeeId === id && x.date >= w.start && x.date <= w.end).reduce((a, x) => a + x.amount, 0)]));
        const totals = trackerTotals(roster, rows, w.days, { daysWorked, penalties });
        return { ...w, totals, ranks: Object.fromEntries(TRACKER_METRICS.map((m) => [m, rankMetric(totals, m)])) };
      }),
    };
  });

  /** Save daily numbers. A value of 0 clears the cell. */
  app.put('/api/tracker/cells', staff, async (req) => {
    const p = userOf(req);
    const body = parse(z.object({ changes: z.array(z.object({ employeeId: uuid, date: isoDate, metric: z.enum(TRACKER_METRICS), value: z.number().int().min(0).max(100000) })).min(1).max(2000) }), req.body);
    const ids = [...new Set(body.changes.map((c) => c.employeeId))];
    const ok = await db.select({ id: schema.employees.id }).from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), inArray(schema.employees.id, ids)));
    if (ok.length !== ids.length) throw badRequest('Unknown employee in changes');
    await db.transaction(async (tx) => {
      for (const c of body.changes) {
        await tx.insert(schema.serverStats).values({ tenantId: p.tenantId, employeeId: c.employeeId, date: c.date, [c.metric]: c.value, updatedBy: p.userId })
          .onConflictDoUpdate({ target: [schema.serverStats.employeeId, schema.serverStats.date], set: { [c.metric]: c.value, updatedBy: p.userId, updatedAt: new Date() } });
      }
      await audit(p, { entity: 'server_stats', action: 'update', after: { cells: body.changes.length } }, tx, req.ip);
    });
    return { ok: true };
  });
}
