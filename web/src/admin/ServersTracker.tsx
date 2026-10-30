import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, peso, todayIso } from '../api';
import { useApi } from '../hooks';
import { METRIC_LABELS, rankMetric, TRACKER_METRICS, type StatRow, type TrackerMetric, type TrackerTotal } from '../../../server/src/stats/tracker';
import Efficiency from './Efficiency';

interface Week { start: string; end: string; days: string[]; label: string; totals: TrackerTotal[]; ranks: Record<TrackerMetric, ReturnType<typeof rankMetric>> }
interface Tracker { month: string; people: { employeeId: string; name: string; position: string | null }[]; stats: StatRow[]; weeks: Week[] }
type SortKey = 'no' | 'name' | 'days' | 'penalties' | TrackerMetric;

/** Server efficiency: the monthly servers tracker (Orders, Sales Comms. = packages, LD's, PO) and the order-slip (OS) check. */
export default function ServerEfficiency() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'os' ? 'os' : 'tracker';
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Server efficiency sections">
        {([['tracker', 'Servers tracker'], ['os', 'Order slips (OS serials)']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams(k === 'tracker' ? {} : { tab: k }, { replace: true })}>{l}</button>
        ))}
      </div>
      {tab === 'os' ? <Efficiency embedded /> : <ServersTracker />}
    </>
  );
}

function ServersTracker() {
  const [month, setMonth] = useState(() => DateTime.fromISO(todayIso()).toFormat('yyyy-LL'));
  const data = useApi<Tracker>(`/api/tracker?month=${month}`);
  const t = data.data;
  const [weekIdx, setWeekIdx] = useState<number | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'no', desc: false });
  useEffect(() => { setWeekIdx('all'); }, [month]);

  const week = t && weekIdx !== 'all' ? t.weeks[weekIdx] : null;
  const days = week ? week.days : t?.weeks.flatMap((w) => w.days) ?? [];
  const totals = useMemo<TrackerTotal[]>(() => {
    if (!t) return [];
    if (week) return week.totals;
    return t.people.map((p) => {
      const mine = t.weeks.map((w) => w.totals.find((x) => x.employeeId === p.employeeId)!);
      const sum = (k: 'penalties' | TrackerMetric) => mine.reduce((a, x) => a + (x?.[k] ?? 0), 0);
      return { ...p, days: mine.reduce((a, x) => a + (x?.days ?? 0), 0), penalties: sum('penalties'), orders: sum('orders'), salesComms: sum('salesComms'), lds: sum('lds'), po: sum('po') };
    });
  }, [t, week]);
  const ranks = useMemo(() => Object.fromEntries(TRACKER_METRICS.map((m) => [m, week ? week.ranks[m] : rankMetric(totals, m)])) as Record<TrackerMetric, ReturnType<typeof rankMetric>>, [totals, week]);
  const order = new Map(t?.people.map((p, i) => [p.employeeId, i]) ?? []);
  const sorted = [...totals].sort((a, b) => {
    const k = sort.key;
    const v = k === 'no' ? (order.get(a.employeeId) ?? 0) - (order.get(b.employeeId) ?? 0) : k === 'name' ? a.name.localeCompare(b.name) : ((a[k] ?? 0) as number) - ((b[k] ?? 0) as number);
    return sort.desc ? -v : v;
  });
  const sum = (k: TrackerMetric | 'penalties') => totals.reduce((a, x) => a + x[k], 0);
  const head = (k: SortKey, label: string, num = true) => (
    <th key={k} className={num ? 'num' : ''} aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="th-sort" onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : k !== 'no' && k !== 'name' })}>{label}{sort.key === k ? (sort.desc ? ' ↓' : ' ↑') : ''}</button>
    </th>
  );
  const title = week ? week.label : t ? `${DateTime.fromISO(`${t.month}-01`).toFormat('LLLL yyyy').toUpperCase()} · WHOLE MONTH` : '';

  return (
    <>
      <div className="page-head">
        <h1>Server efficiency</h1>
        <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center' }}>Month<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
      </div>
      {data.error && <div className="error">{data.error}</div>}
      {t && (
        <>
          <div className="seg" role="group" aria-label="Week" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            <button className={weekIdx === 'all' ? 'on' : ''} onClick={() => setWeekIdx('all')}>Whole month</button>
            {t.weeks.map((w, i) => <button key={w.start} className={weekIdx === i ? 'on' : ''} onClick={() => setWeekIdx(i)}>{DateTime.fromISO(w.start).toFormat('LLL d')}–{DateTime.fromISO(w.end).toFormat('d')}</button>)}
          </div>

          <div className="grid cols-4" style={{ marginBottom: 14 }}>
            {TRACKER_METRICS.map((m) => <div className="tile" key={m}><div className="v">{sum(m).toLocaleString()}</div><div className="k">{METRIC_LABELS[m]}{m === 'salesComms' ? ' (packages)' : ''} · {title.toLowerCase().includes('whole') ? 'this month' : 'this week'}</div></div>)}
          </div>

          <div className="tracker-layout">
            <section className="card table-wrap">
              <div className="card-head"><h2>{title}</h2><span className="spacer" /><span className="muted small">{totals.length} on the floor</span></div>
              <table className="tracker">
                <thead>
                  <tr>{head('no', 'No.', false)}{head('name', 'Name', false)}<th>Position</th>{head('days', 'Days')}{head('penalties', 'Penalties')}{TRACKER_METRICS.map((m) => head(m, METRIC_LABELS[m]))}</tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="muted">{(order.get(r.employeeId) ?? 0) + 1}</td>
                      <td><b>{r.name}</b></td>
                      <td className="muted small">{r.position ?? ''}</td>
                      <td className="num">{r.days ?? '—'}</td>
                      <td className="num">{r.penalties ? <span className="bad-text">{peso(r.penalties)}</span> : <span className="muted">—</span>}</td>
                      {TRACKER_METRICS.map((m) => <td key={m} className={`num ${r[m] ? '' : 'muted'}`}>{r[m] || '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row"><td colSpan={3}>TOTAL</td><td /><td className="num">{peso(sum('penalties'))}</td>{TRACKER_METRICS.map((m) => <td key={m} className="num">{sum(m)}</td>)}</tr>
                </tfoot>
              </table>
            </section>
            <div className="rank-grid">
              {TRACKER_METRICS.map((m) => (
                <section key={m} className="card rank-card">
                  <h3>{METRIC_LABELS[m]}</h3>
                  <div className="rank-cols">
                    <div><div className="k good-text">Top 3</div>{ranks[m].top.length ? <ol>{ranks[m].top.map((x) => <li key={x.employeeId}><span>{x.name}</span><b>{x.total}</b></li>)}</ol> : <p className="muted small">No entries yet</p>}</div>
                    <div><div className="k bad-text">Lowest 3</div><ol>{ranks[m].lowest.map((x) => <li key={x.employeeId}><span>{x.name}</span><b>{x.total}</b></li>)}</ol></div>
                  </div>
                </section>
              ))}
            </div>
          </div>

          <DailyGrid t={t} days={days} onSaved={data.reload} />
        </>
      )}
    </>
  );
}

/** The daily sheet: one metric at a time, one row per person, one column per day — editable. */
function DailyGrid({ t, days, onSaved }: { t: Tracker; days: string[]; onSaved: () => Promise<unknown> }) {
  const [metric, setMetric] = useState<TrackerMetric>('orders');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const value = useMemo(() => new Map(t.stats.map((s) => [`${s.employeeId}|${s.date}`, s])), [t.stats]);
  const cell = (id: string, d: string) => draft[`${id}|${d}|${metric}`] ?? value.get(`${id}|${d}`)?.[metric] ?? 0;
  const dirty = Object.keys(draft).length;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const changes = Object.entries(draft).map(([k, v]) => { const [employeeId, date, m] = k.split('|'); return { employeeId, date, metric: m, value: v }; });
      await api.put('/api/tracker/cells', { changes });
      setDraft({}); setEditing(false); setMsg(`${changes.length} cells saved`);
      await onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const today = todayIso();

  return (
    <section className="card table-wrap" style={{ marginTop: 14 }}>
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <h2>Daily numbers</h2>
        <div className="seg" role="group" aria-label="Metric">{TRACKER_METRICS.map((m) => <button key={m} className={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>{METRIC_LABELS[m]}</button>)}</div>
        <span className="spacer" />
        {msg && <span className="muted small">{msg}</span>}
        {editing
          ? <><button className="btn sm" onClick={() => { setDraft({}); setEditing(false); }}>Cancel</button><button className="btn sm primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : `Save ${dirty || ''}`}</button></>
          : <button className="btn sm" onClick={() => setEditing(true)}>Enter numbers</button>}
      </div>
      <table className="tracker daily">
        <thead>
          <tr><th>Name</th>{days.map((d) => <th key={d} className={`c ${d === today ? 'today' : ''}`}>{DateTime.fromISO(d).toFormat('ccccc')}<div>{DateTime.fromISO(d).toFormat('d')}</div></th>)}<th className="num">Total</th></tr>
        </thead>
        <tbody>
          {t.people.map((p) => {
            const total = days.reduce((a, d) => a + cell(p.employeeId, d), 0);
            return (
              <tr key={p.employeeId}>
                <td><b>{p.name}</b></td>
                {days.map((d) => {
                  const v = cell(p.employeeId, d);
                  return (
                    <td key={d} className="c">
                      {editing
                        ? <input className="cell-in" inputMode="numeric" value={v || ''} aria-label={`${p.name} ${METRIC_LABELS[metric]} on ${d}`}
                            onChange={(e) => { const n = Math.max(0, Math.min(100000, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)); setDraft({ ...draft, [`${p.employeeId}|${d}|${metric}`]: n }); }} />
                        : <span className={v ? '' : 'muted'}>{v || '·'}</span>}
                    </td>
                  );
                })}
                <td className="num"><b>{total}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
