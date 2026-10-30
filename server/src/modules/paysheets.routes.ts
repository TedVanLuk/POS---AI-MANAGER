import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, STAFF_ROLES, userOf } from '../plugins/auth.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { deriveRates } from '../payroll/engine.js';
import { applyRowChanges, buildSheetRows, computeSheet, EDITABLE_FIELDS, periodLabel, type SheetSource } from '../payroll/sheet.js';
import { codeOn, isOnDuty } from '../stats/roster.js';

const money = z.number().min(0).max(10_000_000);
const rowChange = z.object({
  id: z.string().max(64).optional(),
  employeeId: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  sheet: z.string().trim().min(1).max(80).optional(),
  section: z.string().trim().min(1).max(80).optional(),
  days: z.number().min(0).max(31).optional(),
  dailyRate: money.optional(),
  fixedPay: money.nullable().optional(),
  otHours: z.number().min(0).max(300).optional(),
  ndHours: z.number().min(0).max(300).optional(),
  ndPerDay: z.number().min(0).max(12).optional(),
  deductions: money.optional(),
  deductionNote: z.string().trim().max(300).nullable().optional(),
  remarks: z.string().trim().max(300).nullable().optional(),
  paid: z.boolean().optional(),
});

/** Weekly payroll sheets in the client's format (Payroll → Weekly payroll). */
export default async function paySheetRoutes(app: FastifyInstance) {
  const staff = { preHandler: requireUser(STAFF_ROLES) };
  const admin = { preHandler: requireUser(ADMIN_ROLES) };

  const load = async (tenantId: string, id: string) => {
    const [s] = await db.select().from(schema.paySheets).where(and(eq(schema.paySheets.tenantId, tenantId), eq(schema.paySheets.id, id)));
    if (!s) throw notFound('Payroll sheet');
    return s;
  };
  const view = async (s: typeof schema.paySheets.$inferSelect) => {
    const t = await getTenant(s.tenantId);
    const periodDays = DateTime.fromISO(s.periodEnd).diff(DateTime.fromISO(s.periodStart), 'days').days + 1;
    const [fin] = s.finalizedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.finalizedBy)) : [];
    return {
      id: s.id, company: t.name, periodStart: s.periodStart, periodEnd: s.periodEnd, label: periodLabel(s.periodStart, s.periodEnd),
      status: s.status, cashReceived: s.cashReceived, notes: s.notes, finalizedAt: s.finalizedAt, finalizedByName: fin?.name ?? null, updatedAt: s.updatedAt,
      sheetOrder: t.settings.paySheets ?? [], sections: (t.settings.departments ?? []).filter((d) => d.paySheet).map((d) => ({ name: d.name, sheet: d.paySheet!, ndPerDay: d.nightDiffHours ?? 7 })),
      ...computeSheet(s.rows, { cashReceived: s.cashReceived, periodDays, sheetOrder: t.settings.paySheets }),
    };
  };

  app.get('/api/pay-sheets', staff, async (req) => {
    const p = userOf(req);
    const rows = await db.select().from(schema.paySheets).where(eq(schema.paySheets.tenantId, p.tenantId)).orderBy(desc(schema.paySheets.periodStart));
    return rows.map((s) => {
      const c = computeSheet(s.rows, { cashReceived: s.cashReceived, periodDays: 7 });
      return { id: s.id, periodStart: s.periodStart, periodEnd: s.periodEnd, label: periodLabel(s.periodStart, s.periodEnd), status: s.status, people: c.totals.people, amount: c.summary.amount, paid: c.summary.paid, balance: c.summary.balance };
    });
  });

  app.get('/api/pay-sheets/:id', staff, async (req) => {
    const p = userOf(req);
    return view(await load(p.tenantId, (req.params as { id: string }).id));
  });

  /** New sheet for a period, filled from the time clock, from the schedule, or blank. */
  app.post('/api/pay-sheets', admin, async (req) => {
    const p = userOf(req);
    const b = parse(z.object({ periodStart: isoDate, periodEnd: isoDate, source: z.enum(['attendance', 'schedule', 'blank']).default('attendance') }), req.body);
    if (b.periodEnd < b.periodStart) throw badRequest('The period ends before it starts');
    if (DateTime.fromISO(b.periodEnd).diff(DateTime.fromISO(b.periodStart), 'days').days > 31) throw badRequest('A payroll sheet covers at most 31 days');
    const t = await getTenant(p.tenantId);
    let excluded: string[] = [];
    let rows: ReturnType<typeof buildSheetRows>['rows'] = [];
    if (b.source !== 'blank') {
      const emps = await db.select().from(schema.employees).where(and(eq(schema.employees.tenantId, p.tenantId), eq(schema.employees.active, true)));
      const pens = await db.select().from(schema.penalties).where(and(eq(schema.penalties.tenantId, p.tenantId), eq(schema.penalties.status, 'approved'), gte(schema.penalties.date, b.periodStart), lte(schema.penalties.date, b.periodEnd)));
      const days: string[] = [];
      for (let d = DateTime.fromISO(b.periodStart); d <= DateTime.fromISO(b.periodEnd); d = d.plus({ days: 1 })) days.push(d.toISODate()!);
      let worked = new Map<string, { days: number; otMinutes: number }>();
      if (b.source === 'attendance') {
        const { records } = await getDayRecords(p.tenantId, b.periodStart, b.periodEnd, emps.map((e) => e.id));
        worked = new Map(emps.map((e) => { const s = summarize(records.get(e.id) ?? []); return [e.id, { days: s.daysPresent, otMinutes: s.overtimeMinutes }]; }));
      } else {
        const entries = await db.select().from(schema.rosterEntries).where(and(eq(schema.rosterEntries.tenantId, p.tenantId), gte(schema.rosterEntries.date, b.periodStart), lte(schema.rosterEntries.date, b.periodEnd)));
        const over = new Map(entries.map((e) => [`${e.employeeId}|${e.date}`, e.code]));
        worked = new Map(emps.map((e) => [e.id, { days: days.filter((d) => isOnDuty(codeOn(e.weekPattern, over, e.id, d))).length, otMinutes: 0 }]));
      }
      const sources: SheetSource[] = emps.map((e) => {
        const mine = pens.filter((x) => x.employeeId === e.id);
        return {
          id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), department: e.department, dailyRate: deriveRates(e, t.settings.payroll).daily,
          days: worked.get(e.id)?.days ?? 0, otMinutes: worked.get(e.id)?.otMinutes ?? 0,
          penalties: mine.reduce((a, x) => a + x.amount, 0), penaltyNote: mine.length ? mine.map((x) => `${x.date} ${x.reason}`).join('; ') : null,
        };
      });
      ({ rows, excluded } = buildSheetRows(sources, t.settings.departments ?? [], t.settings.paySheets ?? [], randomUUID));
    }
    const [s] = await db.insert(schema.paySheets).values({ tenantId: p.tenantId, periodStart: b.periodStart, periodEnd: b.periodEnd, rows, createdBy: p.userId }).returning();
    await audit(p, { entity: 'pay_sheet', entityId: s.id, action: 'create', after: { period: [b.periodStart, b.periodEnd], source: b.source, rows: rows.length } }, db, req.ip);
    return { id: s.id, rows: rows.length, excluded };
  });

  /** Add, change or remove rows. Every change is kept in the row history (who, when, why). */
  app.put('/api/pay-sheets/:id/rows', staff, async (req) => {
    const p = userOf(req);
    const s = await load(p.tenantId, (req.params as { id: string }).id);
    const b = parse(z.object({ changes: z.array(rowChange).max(500).default([]), remove: z.array(z.string().max(64)).max(500).default([]), reason: z.string().trim().max(300).nullish() }), req.body);
    const touchesMoney = b.remove.length || b.changes.some((c) => !c.id || EDITABLE_FIELDS.some((f) => f !== 'paid' && f !== 'remarks' && f in c));
    if (touchesMoney && !ADMIN_ROLES.includes(p.role)) throw badRequest('Only an owner or admin can change payroll amounts');
    let rows;
    try {
      rows = applyRowChanges(s.rows, b, { id: p.userId, name: p.name }, { reason: b.reason ?? null, now: new Date().toISOString(), newId: randomUUID, locked: s.status === 'final' });
    } catch (e) { throw badRequest((e as Error).message); }
    await db.update(schema.paySheets).set({ rows, updatedAt: new Date() }).where(eq(schema.paySheets.id, s.id));
    await audit(p, { entity: 'pay_sheet', entityId: s.id, action: 'edit_rows', after: { changes: b.changes, remove: b.remove }, reason: b.reason ?? undefined }, db, req.ip);
    return view({ ...s, rows });
  });

  /** Cash received, notes, and finalize / reopen (reopening needs a reason). */
  app.patch('/api/pay-sheets/:id', admin, async (req) => {
    const p = userOf(req);
    const s = await load(p.tenantId, (req.params as { id: string }).id);
    const b = parse(z.object({ cashReceived: money.optional(), notes: z.string().trim().max(1000).nullish(), status: z.enum(['draft', 'final']).optional(), reason: z.string().trim().max(300).nullish() }), req.body);
    if (b.status === 'draft' && s.status === 'final' && !b.reason) throw badRequest('Give a reason for reopening a final payroll');
    const patch: Partial<typeof schema.paySheets.$inferInsert> = { updatedAt: new Date() };
    if (b.cashReceived !== undefined) patch.cashReceived = b.cashReceived;
    if (b.notes !== undefined) patch.notes = b.notes ?? null;
    if (b.status && b.status !== s.status) Object.assign(patch, b.status === 'final' ? { status: 'final', finalizedBy: p.userId, finalizedAt: new Date() } : { status: 'draft', finalizedBy: null, finalizedAt: null });
    const [next] = await db.update(schema.paySheets).set(patch).where(eq(schema.paySheets.id, s.id)).returning();
    await audit(p, { entity: 'pay_sheet', entityId: s.id, action: b.status ? (b.status === 'final' ? 'finalize' : 'reopen') : 'update', before: { status: s.status, cashReceived: s.cashReceived }, after: b, reason: b.reason ?? undefined }, db, req.ip);
    return view(next);
  });

  app.delete('/api/pay-sheets/:id', admin, async (req) => {
    const p = userOf(req);
    const s = await load(p.tenantId, (req.params as { id: string }).id);
    if (s.status === 'final') throw badRequest('Reopen a final payroll before deleting it');
    await db.delete(schema.paySheets).where(eq(schema.paySheets.id, s.id));
    await audit(p, { entity: 'pay_sheet', entityId: s.id, action: 'delete', before: { period: [s.periodStart, s.periodEnd], rows: s.rows.length } }, db, req.ip);
    return { ok: true };
  });
}
