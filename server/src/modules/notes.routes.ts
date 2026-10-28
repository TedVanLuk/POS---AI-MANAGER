import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { findEmployee } from './employees.routes.js';

/** Management notes: performance tracking, commendations, warnings. */
export default async function notesRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };

  app.get('/api/notes', staff, async (req) => {
    const p = userOf(req);
    const q = parse(z.object({ employeeId: uuid.optional() }), req.query);
    const rows = await db.select({ note: schema.managementNotes, authorName: schema.users.name, firstName: schema.employees.firstName, lastName: schema.employees.lastName })
      .from(schema.managementNotes)
      .innerJoin(schema.users, eq(schema.users.id, schema.managementNotes.authorId))
      .innerJoin(schema.employees, eq(schema.employees.id, schema.managementNotes.employeeId))
      .where(and(eq(schema.managementNotes.tenantId, p.tenantId), q.employeeId ? eq(schema.managementNotes.employeeId, q.employeeId) : undefined))
      .orderBy(desc(schema.managementNotes.createdAt)).limit(300);
    return rows.map((r) => ({ ...r.note, authorName: r.authorName, employeeName: `${r.firstName} ${r.lastName}` }));
  });

  app.post('/api/notes', staff, async (req, reply) => {
    const p = userOf(req);
    const body = parse(z.object({
      employeeId: uuid,
      category: z.enum(['commendation', 'coaching', 'warning', 'incident', 'general']),
      title: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(5000),
      rating: z.number().int().min(-3).max(3).default(0),
      visibleToEmployee: z.boolean().default(false),
    }), req.body);
    await findEmployee(p.tenantId, body.employeeId);
    const [n] = await db.insert(schema.managementNotes).values({ ...body, tenantId: p.tenantId, authorId: p.userId }).returning();
    await audit(p, { entity: 'note', entityId: n.id, action: 'create', after: n }, db, req.ip);
    reply.code(201);
    return n;
  });

  app.delete('/api/notes/:id', staff, async (req) => {
    const p = userOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [n] = await db.select().from(schema.managementNotes).where(and(eq(schema.managementNotes.id, id), eq(schema.managementNotes.tenantId, p.tenantId)));
    if (!n) throw notFound('Note');
    if (n.authorId !== p.userId && !ADMIN_ROLES.includes(p.role)) throw forbidden('Only the author or an admin can delete this note');
    await db.delete(schema.managementNotes).where(eq(schema.managementNotes.id, id));
    await audit(p, { entity: 'note', entityId: id, action: 'delete', before: n }, db, req.ip);
    return { ok: true };
  });
}
