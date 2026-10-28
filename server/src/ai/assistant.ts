import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import type { UserPrincipal } from '../plugins/auth.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { efficiencyMetrics, fighterCards, serialGaps } from '../stats/service.js';

const MODEL = 'claude-opus-5-5';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');

const SYSTEM = `You are "AI Manager", the HR analyst inside AI Manager HR, a timekeeping and payroll system used by Philippine businesses.
You answer questions from the business owner/admin using ONLY the data returned by your tools. Never invent numbers; if data is missing, say so.
- Amounts are Philippine pesos (₱) unless stated otherwise. Format money like ₱12,345.67.
- Times are in the tenant's local timezone.
- Be concise and practical: lead with the answer, then the supporting figures (a short table is fine), then at most 2 concrete recommendations when useful.
- For labor-law or penalty questions, note that wage deductions in the Philippines are restricted (Labor Code Art. 113) and suggest confirming with HR/legal when relevant.
- You have read-only access. If asked to change data, explain where in the app the admin can do it (Payroll → run → edit line with a reason, Penalties, Attendance corrections, etc.).`;

/** Read-only, tenant-scoped tools. The tenant comes from the logged-in admin, never from the model. */
function buildTools(p: UserPrincipal, tz: string) {
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x));
  const today = () => DateTime.now().setZone(tz).toISODate()!;

  return [
    betaZodTool({
      name: 'get_today',
      description: 'Today\'s date in the business timezone plus a live attendance snapshot (who is clocked in, late, not in yet).',
      inputSchema: z.object({}),
      run: async () => {
        const date = today();
        const { employees, records } = await getDayRecords(p.tenantId, date, date);
        return json({
          date,
          employees: employees.map((e) => {
            const r = records.get(e.id)![0];
            return { name: `${e.firstName} ${e.lastName}`, position: e.position, present: r.present, firstIn: r.firstIn, lateMinutes: r.lateMinutes, dayType: r.dayType, clockedInNoOut: r.missingOut };
          }),
        });
      },
    }),
    betaZodTool({
      name: 'find_employees',
      description: 'List employees, optionally filtered by a name/position/employee-number search. Returns ids needed by other tools, plus pay type and rate.',
      inputSchema: z.object({ query: z.string().optional().describe('Part of a name, position or employee number') }),
      run: async ({ query }) => {
        const rows = await db.select().from(schema.employees).where(and(
          eq(schema.employees.tenantId, p.tenantId),
          query ? or(ilike(schema.employees.firstName, `%${query}%`), ilike(schema.employees.lastName, `%${query}%`), ilike(schema.employees.position, `%${query}%`), ilike(schema.employees.employeeNo, `%${query}%`)) : undefined,
        )).limit(200);
        return json(rows.map((e) => ({ id: e.id, employeeNo: e.employeeNo, name: `${e.firstName} ${e.lastName}`, position: e.position, department: e.department, payType: e.payType, rate: e.rate, active: e.active, hireDate: e.hireDate })));
      },
    }),
    betaZodTool({
      name: 'get_attendance_summary',
      description: 'Attendance totals per employee for a date range: days present/absent, late count & minutes, undertime, overtime, night-diff minutes, missing punches. Optionally include the day-by-day records for one employee.',
      inputSchema: z.object({ from: isoDate, to: isoDate, employeeId: z.string().uuid().optional(), includeDays: z.boolean().optional() }),
      run: async ({ from, to, employeeId, includeDays }) => {
        const { employees, records } = await getDayRecords(p.tenantId, from, to, employeeId ? [employeeId] : undefined);
        return json(employees.map((e) => ({
          employeeId: e.id, name: `${e.firstName} ${e.lastName}`, totals: summarize(records.get(e.id) ?? []),
          days: includeDays && employeeId ? records.get(e.id)?.map((d) => ({ date: d.date, dayType: d.dayType, present: d.present, absent: d.absent, firstIn: d.firstIn, lastOut: d.lastOut, late: d.lateMinutes, undertime: d.undertimeMinutes, ot: d.overtimeMinutes })) : undefined,
        })));
      },
    }),
    betaZodTool({
      name: 'get_fighter_cards',
      description: 'Performance "fighter card" ratings (0–99) per employee for the last N days: overall, tier and attributes PUN (punctuality), ATT (attendance), SPD (service speed), HUS (order-slip throughput), SAL (sales/hour), DIS (discipline), REP (management reputation), plus the raw figures behind them.',
      inputSchema: z.object({ days: z.number().int().min(7).max(365).optional(), employeeId: z.string().uuid().optional() }),
      run: async ({ days, employeeId }) => json(await fighterCards(p.tenantId, days ?? 30, employeeId)),
    }),
    betaZodTool({
      name: 'get_server_efficiency',
      description: 'Waiter/server efficiency from order slips (OS) for a date range: slips, voids, sales, average ticket, average service minutes, slips & sales per worked hour, and missing OS serial numbers per branch.',
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      run: async ({ from, to }) => json({ servers: await efficiencyMetrics(p.tenantId, from, to), serialGaps: await serialGaps(p.tenantId, from, to) }),
    }),
    betaZodTool({
      name: 'get_payroll_runs',
      description: 'Recent payroll runs with status and totals (gross, deductions, net, employer contributions).',
      inputSchema: z.object({ limit: z.number().int().min(1).max(24).optional() }),
      run: async ({ limit }) => {
        const runs = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.tenantId, p.tenantId)).orderBy(desc(schema.payrollRuns.periodStart)).limit(limit ?? 6);
        const totals = runs.length ? await db.select({ runId: schema.payslips.runId, n: sql<number>`count(*)::int`, gross: sql<number>`sum(gross)::float`, deductions: sql<number>`sum(total_deductions)::float`, net: sql<number>`sum(net)::float` })
          .from(schema.payslips).where(inArray(schema.payslips.runId, runs.map((r) => r.id))).groupBy(schema.payslips.runId) : [];
        return json(runs.map((r) => ({ id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status, ...totals.find((t) => t.runId === r.id) })));
      },
    }),
    betaZodTool({
      name: 'get_payroll_run_detail',
      description: 'Per-employee payslip breakdown for one payroll run (all lines with amounts, manual edits and who edited them).',
      inputSchema: z.object({ runId: z.string().uuid() }),
      run: async ({ runId }) => {
        const slips = await db.select({ slip: schema.payslips, firstName: schema.employees.firstName, lastName: schema.employees.lastName })
          .from(schema.payslips).innerJoin(schema.employees, eq(schema.employees.id, schema.payslips.employeeId))
          .where(and(eq(schema.payslips.runId, runId), eq(schema.payslips.tenantId, p.tenantId)));
        const lines = slips.length ? await db.select().from(schema.payslipLines).where(inArray(schema.payslipLines.payslipId, slips.map((s) => s.slip.id))) : [];
        return json(slips.map((s) => ({
          name: `${s.firstName} ${s.lastName}`, gross: s.slip.gross, deductions: s.slip.totalDeductions, net: s.slip.net,
          lines: lines.filter((l) => l.payslipId === s.slip.id).map((l) => ({ label: l.label, category: l.category, amount: l.amount, enabled: l.enabled, manual: l.isManual, editReason: l.editReason })),
        })));
      },
    }),
    betaZodTool({
      name: 'get_penalties',
      description: 'Penalties (late, absence, missing time-out, disciplinary) with status pending/approved/waived.',
      inputSchema: z.object({ status: z.enum(['pending', 'approved', 'waived']).optional(), employeeId: z.string().uuid().optional() }),
      run: async ({ status, employeeId }) => {
        const rows = await db.select({ x: schema.penalties, firstName: schema.employees.firstName, lastName: schema.employees.lastName }).from(schema.penalties)
          .innerJoin(schema.employees, eq(schema.employees.id, schema.penalties.employeeId))
          .where(and(eq(schema.penalties.tenantId, p.tenantId), status ? eq(schema.penalties.status, status) : undefined, employeeId ? eq(schema.penalties.employeeId, employeeId) : undefined))
          .orderBy(desc(schema.penalties.date)).limit(200);
        return json(rows.map((r) => ({ name: `${r.firstName} ${r.lastName}`, date: r.x.date, kind: r.x.kind, amount: r.x.amount, reason: r.x.reason, status: r.x.status })));
      },
    }),
    betaZodTool({
      name: 'get_management_notes',
      description: 'Management notes (commendations, coaching, warnings, incidents) for an employee or the whole team.',
      inputSchema: z.object({ employeeId: z.string().uuid().optional() }),
      run: async ({ employeeId }) => {
        const rows = await db.select({ n: schema.managementNotes, firstName: schema.employees.firstName, lastName: schema.employees.lastName }).from(schema.managementNotes)
          .innerJoin(schema.employees, eq(schema.employees.id, schema.managementNotes.employeeId))
          .where(and(eq(schema.managementNotes.tenantId, p.tenantId), employeeId ? eq(schema.managementNotes.employeeId, employeeId) : undefined))
          .orderBy(desc(schema.managementNotes.createdAt)).limit(100);
        return json(rows.map((r) => ({ name: `${r.firstName} ${r.lastName}`, date: r.n.createdAt, category: r.n.category, title: r.n.title, body: r.n.body, rating: r.n.rating })));
      },
    }),
  ];
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export async function chat(p: UserPrincipal, history: ChatTurn[]) {
  if (!config.anthropicApiKey) throw new HttpError(503, 'AI chat is not configured. Set ANTHROPIC_API_KEY on the server.');
  const tenant = await getTenant(p.tenantId);
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const today = DateTime.now().setZone(tenant.timezone);

  try {
    const final = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      max_iterations: 10,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Business: ${tenant.name}. Timezone: ${tenant.timezone}. Today is ${today.toFormat('cccc, yyyy-LL-dd')}. Signed-in admin: ${p.name}.` },
      ],
      tools: buildTools(p, tenant.timezone),
      messages: history.map((t) => ({ role: t.role, content: t.content })),
    });
    if (final.stop_reason === 'refusal') return { reply: 'I can\'t help with that request.', stopReason: final.stop_reason };
    const reply = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { reply: reply || 'I could not produce an answer — please rephrase the question.', stopReason: final.stop_reason };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'AI chat: the Anthropic API key was rejected');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI chat is busy — please try again in a moment');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `AI service error (${err.status ?? 'network'})`);
    throw err;
  }
}
