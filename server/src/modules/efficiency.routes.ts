import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { efficiencyMetrics, serialGaps } from '../stats/service.js';

const slipBody = z.object({
  serverEmployeeId: uuid,
  branchId: uuid.nullish(),
  serialNo: z.string().trim().min(1).max(40),
  tableNo: z.string().nullish(),
  openedAt: z.string().datetime({ offset: true }),
  servedAt: z.string().datetime({ offset: true }).nullish(),
  closedAt: z.string().datetime({ offset: true }).nullish(),
  amount: z.number().min(0).default(0),
  itemsCount: z.number().int().min(0).default(0),
  status: z.enum(['open', 'closed', 'void']).default('closed'),
  voidReason: z.string().nullish(),
});

const toRow = (tenantId: string, s: z.infer<typeof slipBody>) => ({
  ...s,
  tenantId,
  openedAt: new Date(s.openedAt),
  servedAt: s.servedAt ? new Date(s.servedAt) : null,
  closedAt: s.closedAt ? new Date(s.closedAt) : null,
});

/** Server efficiency: order slips (OS) with serial numbers entered per server. */
export default async function efficiencyRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  app.get('/api/order-slips', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ from: isoDate, to: isoDate, employeeId: uuid.optional() }), req.query);
    const tenant = await getTenant(p.tenantId);
    return db.select({ slip: schema.orderSlips, firstName: schema.employees.firstName, lastName: schema.employees.lastName })
      .from(schema.orderSlips).innerJoin(schema.employees, eq(schema.employees.id, schema.orderSlips.serverEmployeeId))
      .where(and(
        eq(schema.orderSlips.tenantId, p.tenantId),
        gte(schema.orderSlips.openedAt, DateTime.fromISO(q.from, { zone: tenant.timezone }).startOf('day').toJSDate()),
        lte(schema.orderSlips.openedAt, DateTime.fromISO(q.to, { zone: tenant.timezone }).endOf('day').toJSDate()),
        q.employeeId ? eq(schema.orderSlips.serverEmployeeId, q.employeeId) : undefined,
      )).orderBy(desc(schema.orderSlips.openedAt)).limit(1000)
      .then((rows) => rows.map((r) => ({ ...r.slip, serverName: `${r.firstName} ${r.lastName}` })));
  });

  /** Single or bulk (POS export / CSV) import. Duplicate serials per branch are skipped. */
  app.post('/api/order-slips', staff, async (req) => {
    const p = userOf(req);
    const body = parse(z.union([slipBody, z.object({ slips: z.array(slipBody).min(1).max(5000) })]), req.body);
    const slips = 'slips' in body ? body.slips : [body];
    const inserted = await db.insert(schema.orderSlips).values(slips.map((s) => toRow(p.tenantId, s))).onConflictDoNothing().returning({ id: schema.orderSlips.id });
    await audit(p, { entity: 'order_slip', action: 'import', after: { received: slips.length, inserted: inserted.length } }, db, req.ip);
    return { received: slips.length, inserted: inserted.length, skippedDuplicates: slips.length - inserted.length };
  });

  app.get('/api/efficiency', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    const [metrics, gaps] = await Promise.all([efficiencyMetrics(p.tenantId, q.from, q.to), serialGaps(p.tenantId, q.from, q.to)]);
    return { from: q.from, to: q.to, servers: metrics, serialGaps: gaps };
  });
}
