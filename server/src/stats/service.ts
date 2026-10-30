import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, schema } from '../db/index.js';
import { summarize } from '../attendance/engine.js';
import { getDayRecords, getTenant } from '../attendance/service.js';
import { evaluateTeam } from './performance.js';
import { codeOn } from './roster.js';

/** Per-server order-slip metrics over a date range. */
export async function efficiencyMetrics(tenantId: string, from: string, to: string, employeeIds?: string[]) {
  const tenant = await getTenant(tenantId);
  const start = DateTime.fromISO(from, { zone: tenant.timezone }).startOf('day').toJSDate();
  const end = DateTime.fromISO(to, { zone: tenant.timezone }).endOf('day').toJSDate();
  const rows = await db.select({
    employeeId: schema.orderSlips.serverEmployeeId,
    slips: sql<number>`count(*) filter (where ${schema.orderSlips.status} <> 'void')::int`,
    voids: sql<number>`count(*) filter (where ${schema.orderSlips.status} = 'void')::int`,
    sales: sql<number>`coalesce(sum(${schema.orderSlips.amount}) filter (where ${schema.orderSlips.status} <> 'void'), 0)::float`,
    items: sql<number>`coalesce(sum(${schema.orderSlips.itemsCount}) filter (where ${schema.orderSlips.status} <> 'void'), 0)::int`,
    avgServiceMinutes: sql<number | null>`avg(extract(epoch from (${schema.orderSlips.servedAt} - ${schema.orderSlips.openedAt})) / 60) filter (where ${schema.orderSlips.servedAt} is not null and ${schema.orderSlips.status} <> 'void')::float`,
    avgCloseMinutes: sql<number | null>`avg(extract(epoch from (${schema.orderSlips.closedAt} - ${schema.orderSlips.openedAt})) / 60) filter (where ${schema.orderSlips.closedAt} is not null and ${schema.orderSlips.status} <> 'void')::float`,
  }).from(schema.orderSlips)
    .where(and(
      eq(schema.orderSlips.tenantId, tenantId), gte(schema.orderSlips.openedAt, start), lte(schema.orderSlips.openedAt, end),
      employeeIds ? inArray(schema.orderSlips.serverEmployeeId, employeeIds) : undefined,
    ))
    .groupBy(schema.orderSlips.serverEmployeeId);

  const ids = rows.map((r) => r.employeeId);
  const { employees, records } = ids.length ? await getDayRecords(tenantId, from, to, ids) : { employees: [], records: new Map() };
  return rows.map((r) => {
    const emp = employees.find((e) => e.id === r.employeeId);
    const worked = summarize(records.get(r.employeeId) ?? []).workedMinutes / 60;
    const hours = Math.max(worked, 1);
    return {
      employeeId: r.employeeId,
      name: emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown',
      slips: r.slips,
      voids: r.voids,
      voidRate: r.slips + r.voids ? r.voids / (r.slips + r.voids) : 0,
      sales: r.sales,
      avgTicket: r.slips ? r.sales / r.slips : 0,
      items: r.items,
      avgServiceMinutes: r.avgServiceMinutes,
      avgCloseMinutes: r.avgCloseMinutes,
      hoursWorked: Math.round(worked * 10) / 10,
      slipsPerHour: r.slips / hours,
      salesPerHour: r.sales / hours,
    };
  }).sort((a, b) => b.sales - a.sales);
}

/** Missing order-slip serial numbers per branch — possible lost or unrecorded slips. */
export async function serialGaps(tenantId: string, from: string, to: string) {
  const tenant = await getTenant(tenantId);
  const rows = await db.select({ branchId: schema.orderSlips.branchId, serialNo: schema.orderSlips.serialNo }).from(schema.orderSlips)
    .where(and(
      eq(schema.orderSlips.tenantId, tenantId),
      gte(schema.orderSlips.openedAt, DateTime.fromISO(from, { zone: tenant.timezone }).startOf('day').toJSDate()),
      lte(schema.orderSlips.openedAt, DateTime.fromISO(to, { zone: tenant.timezone }).endOf('day').toJSDate()),
    ));
  const byBranch = new Map<string, { prefix: string; width: number; nums: number[] }>();
  for (const r of rows) {
    const m = r.serialNo.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const key = `${r.branchId ?? '-'}|${m[1]}`;
    const entry = byBranch.get(key) ?? { prefix: m[1], width: m[2].length, nums: [] };
    entry.nums.push(Number(m[2]));
    byBranch.set(key, entry);
  }
  const gaps: { branchId: string | null; prefix: string; missing: string[]; range: [string, string] }[] = [];
  for (const [key, e] of byBranch) {
    const nums = [...new Set(e.nums)].sort((a, b) => a - b);
    const have = new Set(nums);
    const missing: string[] = [];
    for (let n = nums[0]; n <= nums[nums.length - 1] && missing.length < 200; n++) {
      if (!have.has(n)) missing.push(e.prefix + String(n).padStart(e.width, '0'));
    }
    const fmt = (n: number) => e.prefix + String(n).padStart(e.width, '0');
    if (missing.length) gaps.push({ branchId: key.split('|')[0] === '-' ? null : key.split('|')[0], prefix: e.prefix, missing, range: [fmt(nums[0]), fmt(nums[nums.length - 1])] });
  }
  return gaps;
}

/** Employee cards for the team (or one employee): performance over [from, to], scored together. */
export async function employeeCards(tenantId: string, from: string, to: string, employeeId?: string) {
  const { employees, records } = await getDayRecords(tenantId, from, to);
  const ids = employees.map((e) => e.id);
  const [pens, notes, stats, reviews, entries] = await Promise.all([
    db.select().from(schema.penalties).where(and(eq(schema.penalties.tenantId, tenantId), eq(schema.penalties.status, 'approved'), gte(schema.penalties.date, from), lte(schema.penalties.date, to))),
    db.select().from(schema.managementNotes).where(and(eq(schema.managementNotes.tenantId, tenantId), gte(schema.managementNotes.createdAt, DateTime.fromISO(from).toJSDate()))),
    db.select().from(schema.serverStats).where(and(eq(schema.serverStats.tenantId, tenantId), gte(schema.serverStats.date, from), lte(schema.serverStats.date, to))),
    db.select().from(schema.performanceReviews).where(eq(schema.performanceReviews.tenantId, tenantId)).orderBy(desc(schema.performanceReviews.periodEnd)),
    ids.length ? db.select().from(schema.rosterEntries).where(and(eq(schema.rosterEntries.tenantId, tenantId), gte(schema.rosterEntries.date, from), lte(schema.rosterEntries.date, to))) : Promise.resolve([]),
  ]);
  const overrides = new Map(entries.map((e) => [`${e.employeeId}|${e.date}`, e.code]));
  const dates: string[] = [];
  for (let d = DateTime.fromISO(from); d.toISODate()! <= to; d = d.plus({ days: 1 })) dates.push(d.toISODate()!);
  const team = evaluateTeam(employees.map((e) => {
    const mine = stats.filter((x) => x.employeeId === e.id);
    const review = reviews.find((r) => r.employeeId === e.id);
    const myNotes = notes.filter((n) => n.employeeId === e.id);
    const myPens = pens.filter((p) => p.employeeId === e.id);
    return {
      id: e.id,
      department: e.department ?? 'Unassigned',
      attendance: summarize(records.get(e.id) ?? []),
      leaveDays: dates.filter((d) => codeOn(e.weekPattern, overrides, e.id, d) === 'L').length,
      approvedPenalties: myPens.length,
      penaltyAmount: myPens.reduce((a, p) => a + p.amount, 0),
      warnings: myNotes.filter((n) => n.category === 'warning' || n.category === 'incident').length,
      compliments: myNotes.filter((n) => n.category === 'commendation').length,
      sales: mine.length ? { orders: mine.reduce((a, x) => a + x.orders, 0), salesComms: mine.reduce((a, x) => a + x.salesComms, 0), lds: mine.reduce((a, x) => a + x.lds, 0), po: mine.reduce((a, x) => a + x.po, 0), daysWithData: mine.length } : null,
      ratings: review?.ratings ?? null,
    };
  }));
  return employees
    .filter((e) => !employeeId || e.id === employeeId)
    .map((e) => {
      const r = team.get(e.id)!;
      return {
        employeeId: e.id, name: `${e.firstName} ${e.lastName}`.trim(), employeeNo: e.employeeNo, position: e.position, department: e.department, photoUrl: e.photoUrl,
        overall: Math.round(r.scores.overall), tier: r.scores.tier, attributes: r.attributes,
        period: { from, to, days: dates.length },
        performance: { scores: r.scores, rank: r.rank, input: r.input },
      };
    })
    .sort((a, b) => b.performance.scores.overall - a.performance.scores.overall);
}

/** Back-compat helper: cards for the last N days. */
export async function fighterCards(tenantId: string, days = 30, employeeId?: string) {
  const tenant = await getTenant(tenantId);
  const today = DateTime.now().setZone(tenant.timezone);
  return employeeCards(tenantId, today.minus({ days: days - 1 }).toISODate()!, today.toISODate()!, employeeId);
}
