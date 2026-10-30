import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { encrypt } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { hashSecret } from './auth.routes.js';

const employeeBody = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  position: z.string().trim().nullish(),
  department: z.string().trim().nullish(),
  branchId: uuid.nullish(),
  scheduleId: uuid.nullish(),
  payType: z.enum(['monthly', 'daily', 'hourly']),
  rate: z.number().nonnegative(),
  allowances: z.array(z.object({ code: z.string().min(1), label: z.string().min(1), amount: z.number().nonnegative(), taxable: z.boolean().optional() })).default([]),
  exemptions: z.object({ withholdingTax: z.boolean().optional(), sss: z.boolean().optional(), philhealth: z.boolean().optional(), pagibig: z.boolean().optional() }).default({}),
  tin: z.string().nullish(),
  sssNo: z.string().nullish(),
  philhealthNo: z.string().nullish(),
  pagibigNo: z.string().nullish(),
  hireDate: isoDate.nullish(),
  active: z.boolean().default(true),
});

export async function findEmployee(tenantId: string, id: string) {
  const [e] = await db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, tenantId), eq(schema.employees.id, id)));
  if (!e) throw notFound('Employee');
  return e;
}

/** Never expose secrets (PIN hash) to the client. */
export const publicEmployee = ({ pinHash, ...e }: typeof schema.employees.$inferSelect) => ({ ...e, hasPin: !!pinHash });

export default async function employeeRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  app.get('/api/employees', staff, async (req) => {
    const p = userOf(req);
    const rows = await db.select({
      employee: schema.employees,
      branchName: schema.branches.name,
      scheduleName: schema.workSchedules.name,
      fingerprints: sql<number>`(select count(*)::int from fingerprint_templates f where f.employee_id = ${schema.employees.id})`,
    }).from(schema.employees)
      .leftJoin(schema.branches, eq(schema.branches.id, schema.employees.branchId))
      .leftJoin(schema.workSchedules, eq(schema.workSchedules.id, schema.employees.scheduleId))
      .where(eq(schema.employees.tenantId, p.tenantId))
      .orderBy(asc(schema.employees.lastName));
    return rows.map((r) => ({ ...publicEmployee(r.employee), branchName: r.branchName, scheduleName: r.scheduleName, fingerprints: r.fingerprints }));
  });

  app.get('/api/employees/:id', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const e = await findEmployee(p.tenantId, id);
    const fps = await db.select({ id: schema.fingerprintTemplates.id, finger: schema.fingerprintTemplates.finger, format: schema.fingerprintTemplates.format, quality: schema.fingerprintTemplates.quality, createdAt: schema.fingerprintTemplates.createdAt })
      .from(schema.fingerprintTemplates).where(eq(schema.fingerprintTemplates.employeeId, id));
    const [login] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.employeeId, id));
    return { ...publicEmployee(e), fingerprints: fps, loginEmail: login?.email ?? null };
  });

  app.post('/api/employees', admin, async (req, reply) => {
    const p = userOf(req);
    const body = parse(employeeBody, req.body);
    const dup = await db.select({ id: schema.employees.id }).from(schema.employees)
      .where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.employeeNo, body.employeeNo)));
    if (dup.length) throw conflict('Employee number already exists');
    const [e] = await db.insert(schema.employees).values({ ...body, tenantId: p.tenantId }).returning();
    await audit(p, { entity: 'employee', entityId: e.id, action: 'create', after: publicEmployee(e) }, db, req.ip);
    reply.code(201);
    return publicEmployee(e);
  });

  app.patch('/api/employees/:id', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(employeeBody.partial().extend({ reason: z.string().optional() }), req.body);
    const before = await findEmployee(p.tenantId, id);
    const { reason, ...changes } = body;
    if ((changes.rate !== undefined && changes.rate !== before.rate) && !reason) throw badRequest('A reason is required when changing the pay rate');
    const [after] = await db.update(schema.employees).set(changes).where(eq(schema.employees.id, id)).returning();
    await audit(p, { entity: 'employee', entityId: id, action: 'update', before: publicEmployee(before), after: publicEmployee(after), reason }, db, req.ip);
    return publicEmployee(after);
  });

  app.post('/api/employees/:id/pin', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits') }), req.body);
    await findEmployee(p.tenantId, id);
    await db.update(schema.employees).set({ pinHash: await hashSecret(pin) }).where(eq(schema.employees.id, id));
    await audit(p, { entity: 'employee', entityId: id, action: 'set_pin' }, db, req.ip);
    return { ok: true };
  });

  /** Create or reset the employee's self-service login (role: employee). */
  app.post('/api/employees/:id/login', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(8) }), req.body);
    const e = await findEmployee(p.tenantId, id);
    const email = body.email.toLowerCase();
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.employeeId, id));
    const passwordHash = await hashSecret(body.password);
    if (existing) {
      await db.update(schema.users).set({ email, passwordHash }).where(eq(schema.users.id, existing.id));
    } else {
      const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
      if (taken) throw conflict('Email already in use');
      await db.insert(schema.users).values({ tenantId: p.tenantId, email, name: `${e.firstName} ${e.lastName}`, passwordHash, role: 'employee', employeeId: id });
    }
    await audit(p, { entity: 'employee', entityId: id, action: 'set_login', after: { email } }, db, req.ip);
    return { ok: true };
  });

  /** Profile picture: a small image data URL (the browser resizes it), or null to remove. */
  app.put('/api/employees/:id/photo', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { photoUrl } = parse(z.object({
      photoUrl: z.string().max(400_000, 'Photo is too large — use an image under 300 KB')
        .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a JPEG, PNG or WebP image').nullable(),
    }), req.body);
    await findEmployee(p.tenantId, id);
    await db.update(schema.employees).set({ photoUrl }).where(eq(schema.employees.id, id));
    await audit(p, { entity: 'employee', entityId: id, action: photoUrl ? 'set_photo' : 'remove_photo' }, db, req.ip);
    return { ok: true };
  });

  app.post('/api/employees/:id/biometric-consent', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await findEmployee(p.tenantId, id);
    const now = new Date();
    await db.update(schema.employees).set({ biometricConsentAt: now }).where(eq(schema.employees.id, id));
    await audit(p, { entity: 'employee', entityId: id, action: 'biometric_consent', after: { at: now } }, db, req.ip);
    return { ok: true, biometricConsentAt: now };
  });

  /** Enroll a fingerprint template captured on a kiosk/reader. */
  app.post('/api/employees/:id/fingerprints', admin, async (req, reply) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({
      finger: z.enum(['R_THUMB', 'R_INDEX', 'R_MIDDLE', 'R_RING', 'R_LITTLE', 'L_THUMB', 'L_INDEX', 'L_MIDDLE', 'L_RING', 'L_LITTLE']),
      format: z.string().min(2).max(32),
      template: z.string().min(16).max(20000),
      quality: z.number().int().min(0).max(100).optional(),
    }), req.body);
    const e = await findEmployee(p.tenantId, id);
    if (!e.biometricConsentAt) throw badRequest('Record the employee\'s biometric consent (Data Privacy Act) before enrolling');
    const values = { tenantId: p.tenantId, employeeId: id, finger: body.finger, format: body.format, templateEnc: encrypt(body.template), quality: body.quality, createdBy: p.userId };
    const [fp] = await db.insert(schema.fingerprintTemplates).values(values)
      .onConflictDoUpdate({ target: [schema.fingerprintTemplates.employeeId, schema.fingerprintTemplates.finger], set: { templateEnc: values.templateEnc, format: values.format, quality: values.quality, createdBy: p.userId, createdAt: new Date() } })
      .returning({ id: schema.fingerprintTemplates.id, finger: schema.fingerprintTemplates.finger });
    await audit(p, { entity: 'employee', entityId: id, action: 'fingerprint_enroll', after: { finger: body.finger, format: body.format, quality: body.quality } }, db, req.ip);
    reply.code(201);
    return fp;
  });

  app.delete('/api/employees/:id/fingerprints', admin, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await findEmployee(p.tenantId, id);
    const deleted = await db.delete(schema.fingerprintTemplates).where(and(eq(schema.fingerprintTemplates.tenantId, p.tenantId), eq(schema.fingerprintTemplates.employeeId, id))).returning({ id: schema.fingerprintTemplates.id });
    await audit(p, { entity: 'employee', entityId: id, action: 'fingerprint_delete_all', after: { count: deleted.length } }, db, req.ip);
    return { deleted: deleted.length };
  });
}
