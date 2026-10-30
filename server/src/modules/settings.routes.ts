import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';

const hm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const componentsSchema = z.object({
  overtime: z.boolean(), nightDifferential: z.boolean(), holidayPay: z.boolean(), restDayPay: z.boolean(),
  lateDeduction: z.boolean(), undertimeDeduction: z.boolean(), absenceDeduction: z.boolean(), sss: z.boolean(),
  philhealth: z.boolean(), pagibig: z.boolean(), withholdingTax: z.boolean(), thirteenthMonthAccrual: z.boolean(),
  allowances: z.boolean(), penalties: z.boolean(),
}).partial();

const payrollSettingsSchema = z.object({
  frequency: z.enum(['semi_monthly', 'monthly', 'weekly']),
  workDaysPerYear: z.number().int().min(200).max(366),
  hoursPerDay: z.number().min(1).max(12),
  statutorySchedule: z.enum(['split', 'second_cutoff']),
  components: componentsSchema,
  nightDiffStart: hm,
  nightDiffEnd: hm,
  nightDiffRate: z.number().min(0).max(1),
  minOvertimeMinutes: z.number().int().min(0).max(240),
}).partial();

export default async function settingsRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  // ---------- Tenant settings ----------
  app.get('/api/settings', staff, async (req) => {
    const t = await getTenant(userOf(req).tenantId);
    return { name: t.name, timezone: t.timezone, currency: t.currency, settings: t.settings };
  });

  app.patch('/api/settings', admin, async (req) => {
    const p = userOf(req);
    const body = parse(z.object({
      name: z.string().min(1).optional(), timezone: z.string().optional(), payroll: payrollSettingsSchema.optional(), reason: z.string().optional(),
      departments: z.array(z.object({ name: z.string().trim().min(1).max(60), group: z.string().trim().min(1).max(60), dailyRate: z.number().min(0), shiftStart: hm, shiftEnd: hm, paySheet: z.string().trim().max(80).nullish(), nightDiffHours: z.number().min(0).max(12).nullish() })).max(100).optional(),
      paySheets: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    }), req.body);
    const t = await getTenant(p.tenantId);
    const settings = {
      payroll: {
        ...t.settings.payroll,
        ...(body.payroll ?? {}),
        components: { ...t.settings.payroll.components, ...(body.payroll?.components ?? {}) },
      },
      departments: body.departments ?? t.settings.departments ?? [],
      paySheets: body.paySheets ?? t.settings.paySheets ?? [],
    };
    await db.update(schema.tenants).set({ name: body.name ?? t.name, timezone: body.timezone ?? t.timezone, settings }).where(eq(schema.tenants.id, p.tenantId));
    await audit(p, { entity: 'tenant', entityId: p.tenantId, action: 'update_settings', before: t.settings, after: settings, reason: body.reason }, db, req.ip);
    return { ok: true, settings };
  });

  // ---------- Branches ----------
  app.get('/api/branches', staff, async (req) =>
    db.select().from(schema.branches).where(eq(schema.branches.tenantId, userOf(req).tenantId)));
  app.post('/api/branches', admin, async (req) => {
    const p = userOf(req);
    const body = parse(z.object({ name: z.string().min(1), address: z.string().nullish() }), req.body);
    const [b] = await db.insert(schema.branches).values({ ...body, tenantId: p.tenantId }).returning();
    return b;
  });

  // ---------- Work schedules ----------
  const scheduleBody = z.object({
    name: z.string().min(1), startTime: hm, endTime: hm, breakMinutes: z.number().int().min(0).max(240),
    graceMinutes: z.number().int().min(0).max(60), restDays: z.array(z.number().int().min(1).max(7)),
  });
  app.get('/api/schedules', staff, async (req) =>
    db.select().from(schema.workSchedules).where(eq(schema.workSchedules.tenantId, userOf(req).tenantId)));
  app.post('/api/schedules', admin, async (req) => {
    const p = userOf(req);
    const body = parse(scheduleBody, req.body);
    const [s] = await db.insert(schema.workSchedules).values({ ...body, tenantId: p.tenantId }).returning();
    await audit(p, { entity: 'schedule', entityId: s.id, action: 'create', after: s }, db, req.ip);
    return s;
  });
  app.patch('/api/schedules/:id', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(scheduleBody.partial(), req.body);
    const [before] = await db.select().from(schema.workSchedules).where(and(eq(schema.workSchedules.id, id), eq(schema.workSchedules.tenantId, p.tenantId)));
    if (!before) throw notFound('Schedule');
    const [s] = await db.update(schema.workSchedules).set(body).where(eq(schema.workSchedules.id, id)).returning();
    await audit(p, { entity: 'schedule', entityId: id, action: 'update', before, after: s }, db, req.ip);
    return s;
  });

  // ---------- Holidays ----------
  app.get('/api/holidays', staff, async (req) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const p = userOf(req);
    return db.select().from(schema.holidays).where(and(
      eq(schema.holidays.tenantId, p.tenantId),
      q.from ? gte(schema.holidays.date, q.from) : undefined,
      q.to ? lte(schema.holidays.date, q.to) : undefined,
    )).orderBy(schema.holidays.date);
  });
  app.post('/api/holidays', admin, async (req) => {
    const p = userOf(req);
    const body = parse(z.object({ date: isoDate, name: z.string().min(1), type: z.enum(['regular', 'special_non_working', 'special_working']) }), req.body);
    const [h] = await db.insert(schema.holidays).values({ ...body, tenantId: p.tenantId })
      .onConflictDoUpdate({ target: [schema.holidays.tenantId, schema.holidays.date], set: { name: body.name, type: body.type } }).returning();
    await audit(p, { entity: 'holiday', entityId: h.id, action: 'upsert', after: h }, db, req.ip);
    return h;
  });
  app.delete('/api/holidays/:id', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [h] = await db.delete(schema.holidays).where(and(eq(schema.holidays.id, id), eq(schema.holidays.tenantId, p.tenantId))).returning();
    if (!h) throw notFound('Holiday');
    await audit(p, { entity: 'holiday', entityId: id, action: 'delete', before: h }, db, req.ip);
    return { ok: true };
  });

  // ---------- Kiosk devices ----------
  app.get('/api/devices', admin, async (req) => {
    const rows = await db.select().from(schema.devices).where(eq(schema.devices.tenantId, userOf(req).tenantId)).orderBy(desc(schema.devices.createdAt));
    return rows.map(({ tokenHash: _t, ...d }) => d);
  });
  /** Registers a kiosk tablet. The plain token is returned ONCE — paste it into the kiosk setup screen. */
  app.post('/api/devices', admin, async (req, reply) => {
    const p = userOf(req);
    const body = parse(z.object({ name: z.string().min(1), branchId: uuid.nullish(), driver: z.enum(['simulator', 'secugen-webapi', 'android-bridge', 'digitalpersona']).default('simulator') }), req.body);
    const token = randomToken();
    const [d] = await db.insert(schema.devices).values({ ...body, tenantId: p.tenantId, tokenHash: sha256(token) }).returning();
    await audit(p, { entity: 'device', entityId: d.id, action: 'register', after: { name: d.name, driver: d.driver } }, db, req.ip);
    reply.code(201);
    return { id: d.id, name: d.name, driver: d.driver, token };
  });
  app.post('/api/devices/:id/revoke', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [d] = await db.update(schema.devices).set({ active: false }).where(and(eq(schema.devices.id, id), eq(schema.devices.tenantId, p.tenantId))).returning();
    if (!d) throw notFound('Device');
    await audit(p, { entity: 'device', entityId: id, action: 'revoke' }, db, req.ip);
    return { ok: true };
  });

  // ---------- Audit log ----------
  app.get('/api/audit', admin, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ entity: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return db.select({
      log: schema.auditLogs,
      actorName: schema.users.name,
    }).from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
      .where(and(
        eq(schema.auditLogs.tenantId, p.tenantId),
        q.entity ? eq(schema.auditLogs.entity, q.entity) : undefined,
        q.entityId ? eq(schema.auditLogs.entityId, q.entityId) : undefined,
      ))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(q.limit)
      .then((rows) => rows.map((r) => ({ ...r.log, actorName: r.actorName })));
  });
}
