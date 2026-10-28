import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';

export const hashSecret = (s: string) => hash(s, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifySecret = (h: string, s: string) => verify(h, s).catch(() => false);

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const [user] = await db.select().from(schema.users)
      .where(and(eq(schema.users.email, body.email.toLowerCase()), eq(schema.users.active, true)));
    if (!user || !(await verifySecret(user.passwordHash, body.password))) throw new HttpError(401, 'Invalid email or password');
    const payload = { userId: user.id, tenantId: user.tenantId, role: user.role, employeeId: user.employeeId, name: user.name };
    const [tenant] = await db.select({ name: schema.tenants.name, timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, user.tenantId));
    return { token: app.jwt.sign(payload), user: { ...payload, email: user.email, tenantName: tenant?.name, timezone: tenant?.timezone } };
  });

  app.get('/api/auth/me', { preHandler: requireUser([...STAFF_ROLES, 'employee']) }, async (req) => {
    const p = userOf(req);
    const [tenant] = await db.select({ name: schema.tenants.name, timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, p.tenantId));
    return { ...p, tenantName: tenant?.name, timezone: tenant?.timezone };
  });
}
