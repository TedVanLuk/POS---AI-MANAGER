import { analyse, OPERATIONAL_TEMPLATES, type ReviewInput, type Score } from './sevenstep.js';

/** Example 7-step reviews for the demo and the seed: a few nights for people across departments. */
export interface SamplePerson { id: string; name: string; department: string | null; dailyRate: number }

const REVIEWER: Record<string, string> = {
  Servers: 'Khey, Jaysa, Charle', Bartenders: 'MJ / Ara', Bouncers: 'Jonel', Kitchen: 'Josh', Cashiers: 'Jhep', Promoters: 'Noah', Shisha: 'Kristal', Housekeeping: 'Ricky',
};
const REVIEWER_KEY: Record<string, string> = {
  Servers: 'head:Servers', Bartenders: 'head:Bartenders', Bouncers: 'head:Bouncers', Kitchen: 'head:Kitchen', Cashiers: 'head:Cashiers', Promoters: 'head:Promoters', Shisha: 'head:Shisha', Housekeeping: 'head:Housekeeping',
};
const ACTION: Record<number, string> = {
  1: 'Keep on the VIP section tomorrow and recognize at the 9 PM briefing.',
  2: 'Give the high-value tables, with a fixed task list and check-ins at 11 PM and 2 AM.',
  3: 'Pair with the head for the first 3 hours tomorrow; review order slips together at 2 AM.',
  4: 'Final coaching night with written targets; if not met this week, end the contract.',
  5: 'Written warning tomorrow at call time; discuss termination with the Shift Manager.',
};

export function sampleReviews(people: SamplePerson[], dates: string[], seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const out: { employeeId: string; date: string; reviewerRoleKey: string; reviewerName: string; input: ReviewInput; category: number; suggestedCategory: number | null; resultsIndex: number | null; result: string; analysis: string; action: string }[] = [];
  people.forEach((p, i) => {
    // Profiles: mostly A-players and learners, some coasting, a few to act on.
    const profile = [1, 1, 3, 2, 1, 3, 1, 2, 3, 1, 4, 1, 3, 1, 5, 2, 1, 3][i % 18];
    const goodResults = profile <= 2, hard = profile === 1 || profile === 3 || profile === 4;
    const history: { date: string; category: number; resultsIndex: number | null }[] = [];
    for (const date of [...dates].sort()) {
      const assigned = 8 + Math.floor(rand() * 5);
      const completed = hard ? assigned - (rand() < 0.3 ? 1 : 0) : Math.max(2, Math.round(assigned * (0.45 + rand() * 0.25)));
      const scheduled = 8.5;
      const productive = hard ? Math.round((8 + rand() * 0.5) * 10) / 10 : Math.round((5 + rand() * 1.8) * 10) / 10;
      const quality: Score = goodResults ? (rand() < 0.5 ? 'excellent' : 'good') : rand() < 0.7 ? 'bad' : 'terrible';
      const template = (OPERATIONAL_TEMPLATES[p.department ?? ''] ?? OPERATIONAL_TEMPLATES.default).slice(0, 3);
      const operational = template.map((m) => {
        const plan = m.plan ?? (m.name === 'Orders' ? 15 : m.name === "LD's" ? 4 : m.name === 'Table turn time' ? 45 : 2);
        const factor = goodResults ? 1 + rand() * 0.25 : 0.55 + rand() * 0.25;
        const fact = m.lowerIsBetter ? Math.round((plan === 0 ? (goodResults ? 0 : 1 + rand() * 2) : plan / factor) * 10) / 10 : Math.round(plan * factor * (m.unit === '%' ? 0.99 : 1));
        return { ...m, plan, fact: m.unit === '%' ? Math.min(100, fact) : fact };
      });
      const revenuePlan = p.department === 'Servers' ? 12000 : null;
      const input: ReviewInput = {
        tasksAssigned: assigned, tasksCompleted: completed, quantityScore: null, qualityScore: quality, scheduledHours: scheduled, productiveHours: productive, operational,
        revenuePlan, revenueFact: revenuePlan ? Math.round(revenuePlan * (goodResults ? 1 + rand() * 0.3 : 0.5 + rand() * 0.3)) : null, cost: p.dailyRate,
        effort: null, improving: profile === 4 ? false : null,
      };
      const a = analyse(input, [...history].reverse());
      const category = a.suggestedCategory ?? profile;
      history.push({ date, category, resultsIndex: a.resultsIndex });
      out.push({
        employeeId: p.id, date, reviewerRoleKey: REVIEWER_KEY[p.department ?? ''] ?? 'staff:Supervisors', reviewerName: REVIEWER[p.department ?? ''] ?? 'Khey, Jaysa, Charle',
        input, category, suggestedCategory: a.suggestedCategory, resultsIndex: a.resultsIndex,
        result: a.reasons.slice(0, 3).join(' '),
        analysis: goodResults ? (hard ? 'Strong night on every measure.' : 'Results are there but effort is low — finishing early and skipping tasks.') : hard ? 'Works hard but numbers are below plan.' : 'Below plan and not putting in the hours.',
        action: ACTION[category],
      });
    }
  });
  return out;
}
