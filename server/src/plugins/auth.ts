import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fjwt from '@fastify/jwt';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';

export type Role = 'owner' | 'admin' | 'manager' | 'employee';

export type UserPrincipal = {
  kind: 'user';
  userId: string;
  tenantId: string;
  role: Role;
  employeeId: string | null;
  name: string;
};
export type DevicePrincipal = { kind: 'device'; deviceId: string; tenantId: string; branchId: string | null };
export type Principal = UserPrincipal | DevicePrincipal;

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Omit<UserPrincipal, 'kind'>;
  }
}

export const ADMIN_ROLES: Role[] = ['owner', 'admin'];
export const STAFF_ROLES: Role[] = ['owner', 'admin', 'manager'];

export async function registerAuth(app: FastifyInstance) {
  await app.register(fjwt, { secret: config.jwtSecret, sign: { expiresIn: '12h' } });
  app.decorateRequest('principal', null as unknown as never);
}

/** preHandler factory: require a logged-in user with one of the roles. */
export function requireUser(roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    let payload: Omit<UserPrincipal, 'kind'>;
    try {
      payload = await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Not authenticated');
    }
    if (!roles.includes(payload.role)) throw new HttpError(403, 'Insufficient role');
    req.principal = { kind: 'user', ...payload };
  };
}

/** preHandler: authenticate a kiosk tablet by its X-Device-Token header. */
export async function requireDevice(req: FastifyRequest) {
  const token = req.headers['x-device-token'];
  if (typeof token !== 'string' || token.length < 20) throw new HttpError(401, 'Missing device token');
  const [device] = await db.select().from(schema.devices)
    .where(and(eq(schema.devices.tokenHash, sha256(token)), eq(schema.devices.active, true)));
  if (!device) throw new HttpError(401, 'Unknown or revoked device');
  req.principal = { kind: 'device', deviceId: device.id, tenantId: device.tenantId, branchId: device.branchId };
  await db.update(schema.devices).set({ lastSeenAt: new Date() }).where(eq(schema.devices.id, device.id));
}

export function userOf(req: FastifyRequest): UserPrincipal {
  if (req.principal?.kind !== 'user') throw new HttpError(401, 'User session required');
  return req.principal;
}
