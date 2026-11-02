import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { getTenant } from '../attendance/service.js';
import { COMMISSIONS, HANDBOOK_RULES, MDC_HANDBOOK, TABLES } from '../policy/handbook.js';
import { composeJob, createsCycle, resolveRoles, type RoleOverride } from '../policy/jobs.js';

const lines = z.array(z.string().trim().min(1).max(400)).max(30);
const roleBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  holder: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(60).nullable().optional(),
  level: z.enum(['management', 'head', 'staff']).optional(),
  reportsTo: z.string().max(80).nullable().optional(),
  summary: z.string().trim().max(1500).optional(),
  duties: lines.optional(), kpis: lines.optional(), skills: lines.optional(),
  focusRules: z.array(z.number().int().min(1).max(27)).max(27).optional(),
  reason: z.string().trim().max(300).nullish(),
});

/** Company Policy: the employee handbook, the hierarchy and job descriptions. */
export default async function policyRoutes(app: FastifyInstance) {
  const anyUser = { preHandler: requireUser(['owner', 'admin', 'manager', 'employee']) };
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  const overrides = async (tenantId: string) => {
    const rows = await db.select().from(schema.policyDocs).where(eq(schema.policyDocs.tenantId, tenantId));
    return Object.fromEntries(rows.map((r) => [r.key, r.content as RoleOverride]));
  };
  const context = async (tenantId: string) => {
    const [t, over, emps] = await Promise.all([
      getTenant(tenantId), overrides(tenantId),
      db.select({ department: schema.employees.department }).from(schema.employees).where(and(eq(schema.employees.tenantId, tenantId), eq(schema.employees.active, true))),
    ]);
    const headcount: Record<string, number> = {};
    for (const e of emps) if (e.department) headcount[e.department] = (headcount[e.department] ?? 0) + 1;
    return { company: t.name, departments: t.settings.departments ?? [], roles: resolveRoles(over), headcount, over };
  };

  app.get('/api/policy/handbook', anyUser, async (req) => {
    const t = await getTenant(userOf(req).tenantId);
    return { company: t.name, handbook: MDC_HANDBOOK, rules: HANDBOOK_RULES, commissions: COMMISSIONS, tables: TABLES };
  });

  app.get('/api/policy/roles', staff, async (req) => {
    const c = await context(userOf(req).tenantId);
    return { company: c.company, roles: c.roles, headcount: c.headcount, departments: c.departments.map((d) => d.name) };
  });

  app.get('/api/policy/jobs/:key', staff, async (req) => {
    const c = await context(userOf(req).tenantId);
    const role = c.roles.find((x) => x.key === (req.params as { key: string }).key);
    if (!role) throw notFound('Job description');
    return { role, doc: composeJob(role, c) };
  });

  /** Edit a role: title, holder, reporting line or job description text. */
  app.put('/api/policy/roles/:key', admin, async (req) => {
    const p = userOf(req);
    const key = (req.params as { key: string }).key;
    const { reason, ...b } = parse(roleBody, req.body);
    const c = await context(p.tenantId);
    if (!c.roles.some((x) => x.key === key)) throw notFound('Role');
    if (b.reportsTo !== undefined && createsCycle(c.roles, key, b.reportsTo)) throw badRequest('That reporting line would make a loop');
    if (b.reportsTo && !c.roles.some((x) => x.key === b.reportsTo)) throw badRequest('Unknown manager role');
    const content = { ...(c.over[key] ?? {}), ...b };
    await db.insert(schema.policyDocs).values({ tenantId: p.tenantId, key, content, updatedBy: p.userId })
      .onConflictDoUpdate({ target: [schema.policyDocs.tenantId, schema.policyDocs.key], set: { content, updatedBy: p.userId, updatedAt: new Date() } });
    await audit(p, { entity: 'policy_role', action: 'update', before: c.over[key] ?? null, after: { key, ...b }, reason: reason ?? undefined }, db, req.ip);
    return { ok: true };
  });

  app.post('/api/policy/roles', admin, async (req) => {
    const p = userOf(req);
    const { reason, ...b } = parse(roleBody.extend({ title: z.string().trim().min(1).max(120), reportsTo: z.string().max(80) }), req.body);
    const c = await context(p.tenantId);
    if (!c.roles.some((x) => x.key === b.reportsTo)) throw badRequest('Choose who this role reports to');
    const key = `custom:${randomUUID()}`;
    await db.insert(schema.policyDocs).values({ tenantId: p.tenantId, key, content: { ...b, custom: true }, updatedBy: p.userId });
    await audit(p, { entity: 'policy_role', action: 'create', after: { key, ...b }, reason: reason ?? undefined }, db, req.ip);
    return { key };
  });

  /** Remove a custom role, or reset a standard role to the handbook default. */
  app.delete('/api/policy/roles/:key', admin, async (req) => {
    const p = userOf(req);
    const key = (req.params as { key: string }).key;
    const c = await context(p.tenantId);
    if (key.startsWith('custom:') && c.roles.some((x) => x.reportsTo === key)) throw badRequest('Move the roles that report to this one first');
    await db.delete(schema.policyDocs).where(and(eq(schema.policyDocs.tenantId, p.tenantId), eq(schema.policyDocs.key, key)));
    await audit(p, { entity: 'policy_role', action: key.startsWith('custom:') ? 'delete' : 'reset', before: c.over[key] ?? null }, db, req.ip);
    return { ok: true };
  });
}
