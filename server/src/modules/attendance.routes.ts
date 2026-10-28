import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { isoDate, parse, reason, uuid } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { findEmployee } from './employees.routes.js';

export default async function attendanceRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  /** Live board: who's in, who's late, who's absent today. */
  app.get('/api/attendance/today', staff, async (req) => {
    const p = userOf(req);
    const tenant = await getTenant(p.tenantId);
    const q = parse(z.object({ date: isoDate.optional() }), req.query);
    const date = q.date ?? DateTime.now().setZone(tenant.timezone).toISODate()!;
    const { employees, records } = await getDayRecords(p.tenantId, date, date);
    const lastPunches = await db.select().from(schema.attendancePunches)
      .where(and(eq(schema.attendancePunches.tenantId, p.tenantId), eq(schema.attendancePunches.voided, false),
        gte(schema.attendancePunches.punchedAt, DateTime.fromISO(date, { zone: tenant.timezone }).startOf('day').toJSDate()),
        lte(schema.attendancePunches.punchedAt, DateTime.fromISO(date, { zone: tenant.timezone }).endOf('day').toJSDate())))
      .orderBy(desc(schema.attendancePunches.punchedAt));
    const rows = employees.map((e) => {
      const r = records.get(e.id)![0];
      const last = lastPunches.find((x) => x.employeeId === e.id);
      const status = last?.type === 'in' ? 'in' : last?.type === 'out' ? 'out' : r.dayType === 'rest' ? 'rest_day' : r.holiday ? 'holiday' : 'not_in';
      return { employeeId: e.id, name: `${e.firstName} ${e.lastName}`, employeeNo: e.employeeNo, position: e.position, status, lastPunchAt: last?.punchedAt ?? null, record: r };
    });
    return {
      date,
      counts: {
        total: rows.length,
        clockedIn: rows.filter((r) => r.status === 'in').length,
        late: rows.filter((r) => r.record.lateMinutes > 0).length,
        notIn: rows.filter((r) => r.status === 'not_in').length,
      },
      feed: lastPunches.slice(0, 30).map((x) => ({ ...x, name: rows.find((r) => r.employeeId === x.employeeId)?.name })),
      rows,
    };
  });

  /** Day-by-day records for a date range (one or all employees). */
  app.get('/api/attendance/records', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ from: isoDate, to: isoDate, employeeId: uuid.optional() }), req.query);
    const { employees, records } = await getDayRecords(p.tenantId, q.from, q.to, q.employeeId ? [q.employeeId] : undefined);
    return employees.map((e) => {
      const days = records.get(e.id) ?? [];
      return { employeeId: e.id, name: `${e.firstName} ${e.lastName}`, employeeNo: e.employeeNo, totals: summarize(days), days };
    });
  });

  app.get('/api/attendance/punches', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ employeeId: uuid, from: isoDate, to: isoDate }), req.query);
    const tenant = await getTenant(p.tenantId);
    return db.select({ punch: schema.attendancePunches, createdByName: schema.users.name, deviceName: schema.devices.name })
      .from(schema.attendancePunches)
      .leftJoin(schema.users, eq(schema.users.id, schema.attendancePunches.createdBy))
      .leftJoin(schema.devices, eq(schema.devices.id, schema.attendancePunches.deviceId))
      .where(and(
        eq(schema.attendancePunches.tenantId, p.tenantId), eq(schema.attendancePunches.employeeId, q.employeeId),
        gte(schema.attendancePunches.punchedAt, DateTime.fromISO(q.from, { zone: tenant.timezone }).startOf('day').toJSDate()),
        lte(schema.attendancePunches.punchedAt, DateTime.fromISO(q.to, { zone: tenant.timezone }).endOf('day').toJSDate()),
      ))
      .orderBy(schema.attendancePunches.punchedAt)
      .then((rows) => rows.map((r) => ({ ...r.punch, createdByName: r.createdByName, deviceName: r.deviceName })));
  });

  /** Manual correction (forgot to punch, broken reader…). Reason required, audited. */
  app.post('/api/attendance/punches', staff, async (req, reply) => {
    const p = userOf(req);
    const body = parse(z.object({ employeeId: uuid, type: z.enum(['in', 'out']), punchedAt: z.string().datetime({ offset: true }), reason }), req.body);
    await findEmployee(p.tenantId, body.employeeId);
    const [punch] = await db.transaction(async (tx) => {
      const rows = await tx.insert(schema.attendancePunches).values({
        tenantId: p.tenantId, employeeId: body.employeeId, type: body.type, punchedAt: new Date(body.punchedAt),
        method: 'manual', createdBy: p.userId, reason: body.reason,
      }).returning();
      await audit(p, { entity: 'attendance', entityId: rows[0].id, action: 'manual_punch', after: rows[0], reason: body.reason }, tx, req.ip);
      return rows;
    });
    reply.code(201);
    return punch;
  });

  /** Void (never delete) a wrong punch. */
  app.post('/api/attendance/punches/:id/void', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ reason }), req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.attendancePunches).where(and(eq(schema.attendancePunches.id, id), eq(schema.attendancePunches.tenantId, p.tenantId)));
      if (!before) throw notFound('Punch');
      const [after] = await tx.update(schema.attendancePunches).set({ voided: true }).where(eq(schema.attendancePunches.id, id)).returning();
      await audit(p, { entity: 'attendance', entityId: id, action: 'void_punch', before, after, reason: body.reason }, tx, req.ip);
      return after;
    });
  });
}
