import { describe, expect, it } from 'vitest';
import { MDC_DEPARTMENTS } from '../db/mdc-data.js';
import { evaluatePenalties } from '../penalties/engine.js';
import type { DayRecord } from '../attendance/engine.js';
import { HANDBOOK_RULES } from './handbook.js';
import { allJobs, composeJob, createsCycle, resolveRoles } from './jobs.js';

describe('company policy', () => {
  it('has a staff and a head job description for every department', () => {
    const roles = resolveRoles({});
    for (const d of MDC_DEPARTMENTS) {
      const staff = roles.find((r) => r.key === `staff:${d.name}`);
      expect(staff, d.name).toBeTruthy();
      const head = roles.find((r) => r.key === staff!.reportsTo);
      expect(head, `${d.name} head`).toBeTruthy();
      expect(['head', 'management']).toContain(head!.level);
    }
    expect(roles.find((r) => r.key === 'staff:Servers')!.reportsTo).toBe('head:Servers');
    expect(roles.find((r) => r.key === 'head:Servers')!.reportsTo).toBe('staff:Supervisors');
    expect(roles.find((r) => r.key === 'staff:Champagne Girls')!.reportsTo).toBe('head:VIP Host');
    expect(new Set(allJobs().map((r) => r.key)).size).toBe(allJobs().length);
  });

  it('builds one hierarchy under the CEO, as on the organizational chart', () => {
    const roles = resolveRoles({});
    for (const r of roles) {
      let cur: string | null = r.key; let steps = 0;
      while (cur && cur !== 'ceo' && steps++ < 20) cur = roles.find((x) => x.key === cur)!.reportsTo;
      expect(cur, r.key).toBe('ceo');
    }
    expect(roles.find((r) => r.key === 'coo')!.holder).toBe('Tsvetan “Ted” Lukarski');
    const heads = roles.filter((r) => r.no).sort((a, b) => a.no! - b.no!);
    expect(heads.map((r) => r.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(heads.map((r) => r.holder)).toEqual(['Edwin', 'Lhaw', 'Ricky', 'Israel', 'Eka', 'Kimmy', 'Shantal', 'Khey, Jaysa, Charle', 'MJ / Ara', 'Kristal', 'Josh', 'Jhep', 'Jonel', 'Noah']);
    expect(roles.find((r) => r.key === 'head:Maintenance')!.also).toEqual(['snl']);
    expect(roles.some((r) => r.key === 'head:Champagne Girls')).toBe(false);
    expect(createsCycle(roles, 'coo', 'staff:Servers')).toBe(true);
    expect(createsCycle(roles, 'staff:Servers', 'ops')).toBe(false);
  });

  it('applies company edits and composes a job description from the handbook', () => {
    const roles = resolveRoles({ 'head:Bartenders': { holder: 'Mjay', title: 'Bar Manager' } });
    const role = roles.find((r) => r.key === 'head:Bartenders')!;
    expect([role.title, role.holder, role.edited]).toEqual(['Bar Manager', 'Mjay', true]);
    const doc = composeJob(roles.find((r) => r.key === 'staff:Servers')!, { roles, departments: MDC_DEPARTMENTS, headcount: { Servers: 48 }, company: 'MDC' });
    expect(doc.reportsTo?.title).toBe('Head Server');
    expect(doc.schedule[0]).toContain('8:30 PM');
    expect(doc.commissions.some((c) => c.startsWith('Ladies drinks'))).toBe(true);
    expect(doc.requirements.join(' ')).toContain('NBI clearance');
    expect(doc.headcount).toBe(48);
  });

  it('deducts hours of pay for lateness per the handbook scheme', () => {
    const day = (date: string, lateMinutes: number) => ({ date, lateMinutes, absent: false, missingOut: false }) as unknown as DayRecord;
    const rule = { id: 'r', name: 'Late deduction', config: { kind: 'late_tiered' as const, tiers: HANDBOOK_RULES.lateTiers.map((t) => ({ ...t, amount: 0 })) } };
    const out = evaluatePenalties([rule], [day('2026-10-05', 8), day('2026-10-06', 15), day('2026-10-07', 75)], 'w', { hourlyRate: 50 });
    expect(out.map((o) => [o.date, o.amount])).toEqual([['2026-10-06', 50], ['2026-10-07', 200]]);
  });
});
