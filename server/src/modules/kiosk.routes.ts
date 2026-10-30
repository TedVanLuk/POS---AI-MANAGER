import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { decrypt } from '../lib/crypto.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { requireDevice, type DevicePrincipal } from '../plugins/auth.js';
import { getTenant, weekSummary } from '../attendance/service.js';
import { verifySecret } from './auth.routes.js';

const DUPLICATE_WINDOW_MS = 60_000;
const TOGGLE_WINDOW_MS = 18 * 3600_000;
const MAX_BACKDATE_MS = 7 * 24 * 3600_000;

function device(req: { principal: unknown }) {
  return req.principal as DevicePrincipal;
}

/**
 * Records a punch, choosing IN or OUT automatically from the employee's previous punch.
 * Idempotent on clientUuid so the kiosk's offline queue can safely retry.
 */
async function recordPunch(dev: DevicePrincipal, employeeId: string, opts: { clientUuid: string; punchedAt?: string; method: 'fingerprint' | 'pin'; matchScore?: number }, ip?: string) {
  const [emp] = await db.select().from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.tenantId, dev.tenantId), eq(schema.employees.active, true)));
  if (!emp) throw notFound('Employee');

  const [already] = await db.select().from(schema.attendancePunches)
    .where(and(eq(schema.attendancePunches.tenantId, dev.tenantId), eq(schema.attendancePunches.clientUuid, opts.clientUuid)));
  if (already) return { emp, punch: already, duplicate: true };

  const now = Date.now();
  let at = opts.punchedAt ? new Date(opts.punchedAt).getTime() : now;
  if (Number.isNaN(at) || at > now + 120_000) at = now;
  if (now - at > MAX_BACKDATE_MS) throw badRequest('Punch is too old to sync — record it manually with a reason');
  const when = new Date(at);

  const [last] = await db.select().from(schema.attendancePunches)
    .where(and(eq(schema.attendancePunches.tenantId, dev.tenantId), eq(schema.attendancePunches.employeeId, employeeId), eq(schema.attendancePunches.voided, false), lt(schema.attendancePunches.punchedAt, when)))
    .orderBy(desc(schema.attendancePunches.punchedAt)).limit(1);

  if (last && at - last.punchedAt.getTime() < DUPLICATE_WINDOW_MS) return { emp, punch: last, duplicate: true };
  const type: 'in' | 'out' = last && last.type === 'in' && at - last.punchedAt.getTime() < TOGGLE_WINDOW_MS ? 'out' : 'in';

  const [punch] = await db.insert(schema.attendancePunches).values({
    tenantId: dev.tenantId, employeeId, deviceId: dev.deviceId, type, punchedAt: when, method: opts.method,
    matchScore: opts.matchScore, clientUuid: opts.clientUuid,
  }).returning();
  if (opts.method === 'pin') await audit(dev, { entity: 'attendance', entityId: punch.id, action: 'pin_punch', after: { employeeId, type } }, db, ip);
  return { emp, punch, duplicate: false };
}

export default async function kioskRoutes(app: FastifyInstance) {
  const deviceOnly = { preHandler: requireDevice, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.get('/api/kiosk/info', deviceOnly, async (req) => {
    const dev = device(req);
    const tenant = await getTenant(dev.tenantId);
    const [d] = await db.select().from(schema.devices).where(eq(schema.devices.id, dev.deviceId));
    return { tenantName: tenant.name, timezone: tenant.timezone, deviceName: d.name, driver: d.driver };
  });

  /** Templates for 1:N matching on the device. Kept in memory only by the kiosk. */
  app.get('/api/kiosk/templates', deviceOnly, async (req) => {
    const dev = device(req);
    const rows = await db.select({
      employeeId: schema.employees.id, firstName: schema.employees.firstName, lastName: schema.employees.lastName,
      employeeNo: schema.employees.employeeNo, finger: schema.fingerprintTemplates.finger,
      format: schema.fingerprintTemplates.format, templateEnc: schema.fingerprintTemplates.templateEnc,
    }).from(schema.fingerprintTemplates)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.fingerprintTemplates.employeeId))
      .where(and(
        eq(schema.fingerprintTemplates.tenantId, dev.tenantId),
        eq(schema.employees.active, true),
        dev.branchId ? or(eq(schema.employees.branchId, dev.branchId), isNull(schema.employees.branchId)) : undefined,
      ));
    return rows.map(({ templateEnc, ...r }) => ({ ...r, template: decrypt(templateEnc) }));
  });

  /** Employee roster for the kiosk (names only) — used for enrollment and PIN fallback. */
  app.get('/api/kiosk/employees', deviceOnly, async (req) => {
    const dev = device(req);
    return db.select({ id: schema.employees.id, employeeNo: schema.employees.employeeNo, firstName: schema.employees.firstName, lastName: schema.employees.lastName })
      .from(schema.employees).where(and(eq(schema.employees.tenantId, dev.tenantId), eq(schema.employees.active, true)));
  });

  app.post('/api/kiosk/punch', deviceOnly, async (req) => {
    const dev = device(req);
    const body = parse(z.object({ clientUuid: uuid, employeeId: uuid, matchScore: z.number().int().min(0).max(1000).optional(), punchedAt: z.string().datetime({ offset: true }).optional() }), req.body);
    const r = await recordPunch(dev, body.employeeId, { ...body, method: 'fingerprint' }, req.ip);
    return {
      duplicate: r.duplicate,
      type: r.punch.type,
      punchedAt: r.punch.punchedAt,
      employee: { id: r.emp.id, name: `${r.emp.firstName} ${r.emp.lastName}`, employeeNo: r.emp.employeeNo, position: r.emp.position, photoUrl: r.emp.photoUrl },
      week: await weekSummary(dev.tenantId, r.emp.id),
    };
  });

  /** Fallback when a finger can't be read: employee number + PIN. Audited. */
  app.post('/api/kiosk/pin-punch', { ...deviceOnly, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const dev = device(req);
    const body = parse(z.object({ clientUuid: uuid, employeeNo: z.string().min(1), pin: z.string().regex(/^\d{4,6}$/), punchedAt: z.string().datetime({ offset: true }).optional() }), req.body);
    const [emp] = await db.select().from(schema.employees)
      .where(and(eq(schema.employees.tenantId, dev.tenantId), eq(schema.employees.employeeNo, body.employeeNo), eq(schema.employees.active, true)));
    if (!emp?.pinHash || !(await verifySecret(emp.pinHash, body.pin))) throw new HttpError(401, 'Wrong employee number or PIN');
    const r = await recordPunch(dev, emp.id, { clientUuid: body.clientUuid, punchedAt: body.punchedAt, method: 'pin' }, req.ip);
    return {
      duplicate: r.duplicate,
      type: r.punch.type,
      punchedAt: r.punch.punchedAt,
      employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`, employeeNo: emp.employeeNo, position: emp.position, photoUrl: emp.photoUrl },
      week: await weekSummary(dev.tenantId, emp.id),
    };
  });

  /** "My week" — after a successful local fingerprint match, without punching. */
  app.post('/api/kiosk/week', deviceOnly, async (req) => {
    const dev = device(req);
    const { employeeId } = parse(z.object({ employeeId: uuid }), req.body);
    const [emp] = await db.select().from(schema.employees).where(and(eq(schema.employees.id, employeeId), eq(schema.employees.tenantId, dev.tenantId)));
    if (!emp) throw notFound('Employee');
    return { employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`, employeeNo: emp.employeeNo, position: emp.position, photoUrl: emp.photoUrl }, week: await weekSummary(dev.tenantId, emp.id) };
  });
}
