import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getDayRecords } from '../attendance/service.js';
import { evaluatePenalties } from './engine.js';

/**
 * Run active penalty rules over a date range and store new candidates.
 * Existing penalties (same rule + source key) are left untouched, so decisions are never overwritten.
 */
export async function generatePenalties(tenantId: string, from: string, to: string, employeeIds?: string[]) {
  const rules = await db.select().from(schema.penaltyRules)
    .where(and(eq(schema.penaltyRules.tenantId, tenantId), eq(schema.penaltyRules.active, true)));
  if (!rules.length) return { created: 0 };
  const { records } = await getDayRecords(tenantId, from, to, employeeIds);
  let created = 0;
  for (const [employeeId, days] of records) {
    const candidates = evaluatePenalties(rules.map((r) => ({ id: r.id, name: r.name, config: r.config })), days, from);
    for (const c of candidates) {
      const rule = rules.find((r) => r.id === c.ruleId)!;
      const inserted = await db.insert(schema.penalties).values({
        tenantId, employeeId, ruleId: c.ruleId, date: c.date, kind: c.kind, minutes: c.minutes, amount: c.amount,
        reason: c.reason, sourceKey: c.sourceKey, status: rule.autoApprove ? 'approved' : 'pending',
        decidedAt: rule.autoApprove ? new Date() : null, decisionReason: rule.autoApprove ? 'Auto-approved by rule' : null,
      }).onConflictDoNothing().returning({ id: schema.penalties.id });
      created += inserted.length;
    }
  }
  return { created };
}
