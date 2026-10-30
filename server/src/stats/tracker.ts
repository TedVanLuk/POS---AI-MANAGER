import { DateTime } from 'luxon';

/**
 * Pure helpers for the Servers tracker: daily Orders / Sales Comms / LD's / PO per server,
 * grouped into the month's Monday–Sunday weeks (first and last week clipped to the month),
 * weekly totals and top / lowest 3 per metric.
 */

export const TRACKER_METRICS = ['orders', 'salesComms', 'lds', 'po'] as const;
export type TrackerMetric = typeof TRACKER_METRICS[number];
export const METRIC_LABELS: Record<TrackerMetric, string> = { orders: 'Orders', salesComms: 'Sales Comms.', lds: "LD's", po: 'PO' };
export interface StatRow { employeeId: string; date: string; orders: number; salesComms: number; lds: number; po: number }

/** Weeks of a month, e.g. Oct 2026 → 1–4, 5–11, 12–18, 19–25, 26–31. */
export function monthWeeks(month: string) {
  const first = DateTime.fromISO(`${month}-01`);
  const last = first.endOf('month').startOf('day');
  const weeks: { start: string; end: string; days: string[]; label: string }[] = [];
  let cur = first;
  while (cur <= last) {
    const end = DateTime.min(cur.endOf('week').startOf('day'), last);
    const days: string[] = [];
    for (let d = cur; d <= end; d = d.plus({ days: 1 })) days.push(d.toISODate()!);
    weeks.push({ start: cur.toISODate()!, end: end.toISODate()!, days, label: `${cur.toFormat('LLLL').toUpperCase()} ${cur.day}-${end.day}, ${cur.year}` });
    cur = end.plus({ days: 1 });
  }
  return weeks;
}

export interface TrackerPerson { employeeId: string; name: string; position: string | null }

/** Totals per person for a set of days, with attendance days and penalty amounts merged in. */
export function trackerTotals(people: TrackerPerson[], stats: StatRow[], days: string[], extra?: { daysWorked?: Map<string, number>; penalties?: Map<string, number> }) {
  const inRange = new Set(days);
  return people.map((p) => {
    const mine = stats.filter((s) => s.employeeId === p.employeeId && inRange.has(s.date));
    const sum = (k: TrackerMetric) => mine.reduce((a, s) => a + (s[k] ?? 0), 0);
    return {
      ...p,
      days: extra?.daysWorked?.get(p.employeeId) ?? null,
      penalties: extra?.penalties?.get(p.employeeId) ?? 0,
      orders: sum('orders'), salesComms: sum('salesComms'), lds: sum('lds'), po: sum('po'),
    };
  });
}
export type TrackerTotal = ReturnType<typeof trackerTotals>[number];

/** Top 3 (highest, > 0) and lowest 3 (among people with a schedule that week) for one metric. */
export function rankMetric(totals: TrackerTotal[], metric: TrackerMetric, n = 3) {
  const top = totals.filter((t) => t[metric] > 0).sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)).slice(0, n)
    .map((t, i) => ({ rank: i + 1, employeeId: t.employeeId, name: t.name, total: t[metric] }));
  const lowest = [...totals].sort((a, b) => a[metric] - b[metric] || a.name.localeCompare(b.name)).slice(0, n)
    .map((t, i) => ({ rank: i + 1, employeeId: t.employeeId, name: t.name, total: t[metric] }));
  return { top, lowest };
}
