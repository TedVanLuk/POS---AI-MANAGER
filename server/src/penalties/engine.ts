import type { DayRecord } from '../attendance/engine.js';
import type { PenaltyRuleConfig } from '../db/schema.js';

/**
 * Pure penalty engine: evaluates management-defined rules against attendance records
 * and returns candidate penalties. The service stores them as `pending` (or `approved`
 * when the rule auto-approves); only approved penalties are deducted in payroll.
 *
 * NOTE (PH): Labor Code Art. 113 restricts wage deductions. Penalty policies must be
 * written, communicated to employees and reviewed by counsel before being enforced.
 */

export interface RuleInput { id: string; name: string; config: PenaltyRuleConfig }

export interface PenaltyCandidate {
  ruleId: string;
  date: string;
  kind: string;
  minutes: number | null;
  amount: number;
  reason: string;
  sourceKey: string;
}

export function evaluatePenalties(rules: RuleInput[], days: DayRecord[], windowKey: string): PenaltyCandidate[] {
  const out: PenaltyCandidate[] = [];
  for (const rule of rules) {
    const cfg = rule.config;
    switch (cfg.kind) {
      case 'late_tiered':
        for (const d of days) {
          if (d.lateMinutes <= 0) continue;
          const tier = cfg.tiers.find((t) => d.lateMinutes >= t.minMinutes && (t.maxMinutes === null || d.lateMinutes <= t.maxMinutes));
          if (!tier || tier.amount <= 0) continue;
          out.push({ ruleId: rule.id, date: d.date, kind: 'late', minutes: d.lateMinutes, amount: tier.amount, reason: `${rule.name}: late ${d.lateMinutes} min`, sourceKey: `late:${d.date}` });
        }
        break;
      case 'late_frequency': {
        const lates = days.filter((d) => d.lateMinutes > 0);
        if (lates.length >= cfg.threshold) {
          const last = lates[lates.length - 1];
          out.push({ ruleId: rule.id, date: last.date, kind: 'late_frequency', minutes: null, amount: cfg.amount, reason: `${rule.name}: ${lates.length} lates (limit ${cfg.threshold})`, sourceKey: `latefreq:${windowKey}` });
        }
        break;
      }
      case 'absence':
        for (const d of days) {
          if (!d.absent) continue;
          out.push({ ruleId: rule.id, date: d.date, kind: 'absence', minutes: null, amount: cfg.amount, reason: `${rule.name}: absent without record`, sourceKey: `absence:${d.date}` });
        }
        break;
      case 'missing_timeout':
        for (const d of days) {
          if (!d.missingOut) continue;
          out.push({ ruleId: rule.id, date: d.date, kind: 'missing_timeout', minutes: null, amount: cfg.amount, reason: `${rule.name}: no time-out recorded`, sourceKey: `missingout:${d.date}` });
        }
        break;
    }
  }
  return out;
}
