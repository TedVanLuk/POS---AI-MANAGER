import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { api, peso, todayIso } from '../api';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { projectRoster, type RosterWeek } from '../../../server/src/stats/roster';
import { CODE_OPTIONS, codeInfo } from './roster-codes';

const DAY = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
type Tab = 'schedule' | 'summary' | 'projection';
interface Picking { employeeId: string; name: string; date: string; code: string }

/** Weekly staff schedule in the MDC sheet format, its summary (people per day × amount = EST. payroll) and a head-count projection. */
export default function Schedules() {
  const thisWeek = DateTime.fromISO(todayIso()).startOf('week').toISODate()!;
  const [start, setStart] = useState(thisWeek);
  const week = useApi<RosterWeek>(`/api/roster/week?start=${start}`);
  const w = week.data;
  const [tab, setTab] = useState<Tab>('schedule');
  const [dept, setDept] = useState('');
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [counts, setCounts] = useState<Record<string, number[]>>({});
  const shift = (weeks: number) => { setStart(DateTime.fromISO(start).plus({ weeks }).toISODate()!); setCounts({}); };

  const weekLabel = w ? `${DateTime.fromISO(w.weekStart).toFormat('LLL d')} – ${DateTime.fromISO(w.weekStart).plus({ days: 6 }).toFormat('LLL d, yyyy')}` : '';
  const staffCount = w?.departments.reduce((a, d) => a + d.rows.length, 0) ?? 0;
  const personDays = w?.totals.reduce((a, n) => a + n, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Schedules</h1>
        <div className="row" style={{ gap: '.4rem' }}>
          <button className="round-nav" onClick={() => shift(-1)} aria-label="Previous week"><Icon name="left" /></button>
          <b style={{ minWidth: 180, textAlign: 'center' }}>{weekLabel}</b>
          <button className="round-nav" onClick={() => shift(1)} aria-label="Next week"><Icon name="right" /></button>
          {start !== thisWeek && <button className="btn sm" onClick={() => { setStart(thisWeek); setCounts({}); }}>This week</button>}
        </div>
      </div>
      {week.error && <div className="error">{week.error}</div>}
      {w && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 14 }}>
            <div className="tile"><div className="v">{staffCount}</div><div className="k">Staff on the schedule · {w.departments.length} departments</div></div>
            <div className="tile"><div className="v">{(personDays / 7).toFixed(1)}</div><div className="k">Average people on duty per day ({personDays} person-days)</div></div>
            <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{pesoShort(w.estPayroll)}</div><div className="k">EST. payroll this week</div></div>
            <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{pesoShort(w.monthly)}</div><div className="k">Per month · {pesoShort(w.yearly)} per year</div></div>
          </div>
          <div className="tabs" role="tablist" aria-label="Schedule views">
            {([['schedule', 'Weekly schedule'], ['summary', 'Summary & EST. payroll'], ['projection', 'Projection']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'schedule' && <ScheduleGrid w={w} dept={dept} setDept={setDept} editing={editing} setEditing={setEditing} onPick={setPicking} />}
          {tab === 'summary' && <Summary w={w} />}
          {tab === 'projection' && <Projection w={w} counts={counts} setCounts={setCounts} />}
        </>
      )}
      {picking && <CellPicker p={picking} onClose={() => setPicking(null)} onSaved={async () => { setPicking(null); await week.reload(); }} />}
    </>
  );
}

function ScheduleGrid({ w, dept, setDept, editing, setEditing, onPick }: {
  w: RosterWeek; dept: string; setDept: (d: string) => void; editing: boolean; setEditing: (v: boolean) => void; onPick: (p: Picking) => void;
}) {
  const today = todayIso();
  const shown = w.groups.map((g) => ({ ...g, deps: w.departments.filter((d) => d.group === g.group && (!dept || d.name === dept)) })).filter((g) => g.deps.length);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{w.departments.map((d) => <option key={d.name}>{d.name}</option>)}</select>
        <div className="roster-legend">
          {CODE_OPTIONS.filter((o) => o.code && o.code !== 'X').map((o) => <span key={o.code} className={`rc ${o.cls}`}>{o.label}</span>)}
          <span className="rc time">Set time</span>
        </div>
        <div className="spacer" />
        <button className={`btn ${editing ? 'primary' : ''}`} onClick={() => setEditing(!editing)} aria-pressed={editing}>{editing ? 'Done editing' : 'Edit schedule'}</button>
      </div>
      {editing && <div className="notice" style={{ marginBottom: 12 }}>Click any day to change it — for this week only, or for every week (the person's usual week). Changed days are marked with a dot.</div>}
      {shown.map((g) => (
        <section key={g.group} className="card table-wrap roster-card">
          <h2 className="roster-group">{g.group.toUpperCase()}</h2>
          <table className="roster mdc">
            <thead>
              <tr><th>Name</th><th>Position</th>{w.days.map((d, i) => <th key={d} className={`c ${d === today ? 'today' : ''}`}>{DAY[i]}<div className="muted small">{DateTime.fromISO(d).toFormat('d')}</div></th>)}</tr>
            </thead>
            {g.deps.map((d) => (
              <tbody key={d.name}>
                <tr className="dep-row"><td colSpan={2}><b>{d.name.toUpperCase()}</b> <span className="muted small">· {peso(d.dailyRate)}/day · {d.rows.length} staff</span></td>{w.days.map((x) => <td key={x} />)}</tr>
                {d.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td className="nm">{r.name}</td>
                    <td className="muted small">{r.position ?? ''}</td>
                    {r.cells.map((c, i) => {
                      const info = codeInfo(c.code);
                      const label = c.code && info.cls === 'time' ? c.code : info.label;
                      return (
                        <td key={c.date} className="c">
                          {editing
                            ? <button className={`rc ${info.cls} ${c.override ? 'changed' : ''}`} onClick={() => onPick({ employeeId: r.employeeId, name: r.name, date: c.date, code: c.code })} aria-label={`${r.name}, ${DAY[i]}: ${label}. Change`}>{label}</button>
                            : <span className={`rc ${info.cls} ${c.override ? 'changed' : ''}`}>{label}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="total-row"><td colSpan={2}>TOTAL</td>{d.totals.map((n, i) => <td key={i} className="c">{n}</td>)}</tr>
              </tbody>
            ))}
          </table>
        </section>
      ))}
    </>
  );
}

function CellPicker({ p, onClose, onSaved }: { p: Picking; onClose: () => void; onSaved: () => Promise<void> }) {
  const known = CODE_OPTIONS.some((o) => o.code === p.code);
  const [code, setCode] = useState(known ? p.code : '__time');
  const [time, setTime] = useState(known ? '10-1' : p.code);
  const [scope, setScope] = useState<'week' | 'always'>('week');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const day = DateTime.fromISO(p.date);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put('/api/roster/cells', { scope, changes: [{ employeeId: p.employeeId, date: p.date, code: code === '__time' ? time.trim() : code }] });
      await onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${p.name} · ${day.toFormat('cccc, LLL d')}`} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || (code === '__time' && !time.trim())} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="code-pick" role="radiogroup" aria-label="Status">
        {CODE_OPTIONS.map((o) => (
          <button key={o.code} role="radio" aria-checked={code === o.code} className={`rc ${o.cls} ${code === o.code ? 'sel' : ''}`} onClick={() => setCode(o.code)}>{o.label === '—' ? 'Blank' : o.label}</button>
        ))}
        <button role="radio" aria-checked={code === '__time'} className={`rc time ${code === '__time' ? 'sel' : ''}`} onClick={() => setCode('__time')}>Set time…</button>
      </div>
      {code === '__time' && <label className="field" style={{ marginTop: 10 }}>Set time (counts as on duty)<input value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 10-1:30" maxLength={16} /></label>}
      <div className="seg" role="group" aria-label="Apply to" style={{ marginTop: 14 }}>
        <button className={scope === 'week' ? 'on' : ''} onClick={() => setScope('week')}>This week only</button>
        <button className={scope === 'always' ? 'on' : ''} onClick={() => setScope('always')}>Every {day.toFormat('cccc')}</button>
      </div>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}

/** The sheet's summary: people on duty per department per day, Amount (daily rate) and EST. PAYROLL. */
function Summary({ w }: { w: RosterWeek }) {
  return (
    <section className="card table-wrap">
      <table className="hc mdc-sum">
        <thead>
          <tr><th>Departments</th>{DAY.map((d) => <th key={d} className="c">{d === 'SUN' ? 'SUN' : d}</th>)}<th className="num">Total</th><th className="num">Amount</th><th className="num">EST. payroll</th></tr>
        </thead>
        {w.groups.map((g) => (
          <tbody key={g.group}>
            <tr className="dep-row"><td colSpan={11}><b>{g.group.toUpperCase()}</b></td></tr>
            {w.departments.filter((d) => d.group === g.group).map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                {d.totals.map((n, i) => <td key={i} className="c">{n}</td>)}
                <td className="num"><b>{d.personDays}</b></td>
                <td className="num">{peso(d.dailyRate)}</td>
                <td className="num">{peso(d.estPayroll)}</td>
              </tr>
            ))}
            <tr className="total-row"><td>Subtotal</td>{g.totals.map((n, i) => <td key={i} className="c">{n}</td>)}<td className="num">{g.totals.reduce((a, n) => a + n, 0)}</td><td /><td className="num">{peso(g.estPayroll)}</td></tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="grand"><td>TOTAL PEOPLE</td>{w.totals.map((n, i) => <td key={i} className="c">{n}</td>)}<td className="num">{w.totals.reduce((a, n) => a + n, 0)}</td><td /><td className="num">{peso(w.estPayroll)}</td></tr>
          <tr><td>Salary cost per day</td>{w.dayCost.map((n, i) => <td key={i} className="c small">{pesoShort(n)}</td>)}<td /><td /><td className="num muted small">{pesoShort(w.monthly)} / month</td></tr>
        </tfoot>
      </table>
    </section>
  );
}

/** Change the number of people per department per day and see the cost per day, week, month and year. */
function Projection({ w, counts, setCounts }: { w: RosterWeek; counts: Record<string, number[]>; setCounts: (c: Record<string, number[]>) => void }) {
  const get = (dep: RosterWeek['departments'][number]) => counts[dep.name] ?? dep.totals;
  const proj = useMemo(() => projectRoster(w, counts), [w, counts]);
  const changed = w.departments.some((d) => counts[d.name]?.some((n, i) => n !== d.totals[i]));
  const set = (dep: RosterWeek['departments'][number], i: number, n: number) => {
    const next = [...get(dep)];
    next[i] = Math.max(0, Math.min(99, Math.round(n) || 0));
    setCounts({ ...counts, [dep.name]: next });
  };
  const allDays = (dep: RosterWeek['departments'][number], delta: number) => setCounts({ ...counts, [dep.name]: get(dep).map((n) => Math.max(0, n + delta)) });
  const periods = [['day', 'Per day (average)'], ['week', 'Per week'], ['month', 'Per month'], ['year', 'Per year']] as const;

  return (
    <>
      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><h2>Projected salary cost</h2><span className="spacer" />{changed && <button className="btn sm" onClick={() => setCounts({})}>Reset to schedule</button>}</div>
        <div className="proj">
          {periods.map(([k, label]) => {
            const p = proj.periods[k];
            const tone = p.difference < 0 ? 'save' : p.difference > 0 ? 'spend' : '';
            return (
              <div key={k} className={`proj-card ${tone}`}>
                <div className="k">{label}</div>
                <div className="v">{pesoShort(p.scenario)}</div>
                <div className="b">Schedule: {pesoShort(p.baseline)}</div>
                <div className="d">{p.difference === 0 ? 'No change' : p.difference < 0 ? `You save ${pesoShort(-p.difference)}` : `You spend ${pesoShort(p.difference)} more`}</div>
              </div>
            );
          })}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>Cost = people on duty × department daily rate. Month = week × 52 ÷ 12; year = week × 52. Change the numbers below; the schedule itself is not changed.</p>
      </section>
      <section className="card table-wrap">
        <table className="hc">
          <thead>
            <tr><th>Department</th><th className="num">Rate</th>{DAY.map((d) => <th key={d} className="c">{d}</th>)}<th className="c">All days</th><th className="num">Week cost</th></tr>
          </thead>
          <tbody>
            {w.departments.map((d) => {
              const c = get(d);
              const pd = proj.perDept.find((x) => x.name === d.name)!;
              return (
                <tr key={d.name}>
                  <td>{d.name}<div className="muted small">{d.group}</div></td>
                  <td className="num small">{peso(d.dailyRate)}</td>
                  {c.map((n, i) => (
                    <td key={i} className="c">
                      <span className="stepper">
                        <button onClick={() => set(d, i, n - 1)} disabled={n <= 0} aria-label={`One less ${d.name} on ${DAY[i]}`}><Icon name="minus" /></button>
                        <input value={n} inputMode="numeric" onChange={(e) => set(d, i, Number(e.target.value))} aria-label={`${d.name} on ${DAY[i]}`} />
                        <button onClick={() => set(d, i, n + 1)} aria-label={`One more ${d.name} on ${DAY[i]}`}><Icon name="plus" /></button>
                      </span>
                      {n !== d.totals[i] && <div className={`delta ${n > d.totals[i] ? 'up' : 'down'}`}>{n > d.totals[i] ? '+' : ''}{n - d.totals[i]}</div>}
                    </td>
                  ))}
                  <td className="c">
                    <span className="stepper">
                      <button onClick={() => allDays(d, -1)} aria-label={`One less ${d.name} every day`}><Icon name="minus" /></button>
                      <button onClick={() => allDays(d, 1)} aria-label={`One more ${d.name} every day`}><Icon name="plus" /></button>
                    </span>
                  </td>
                  <td className="num">{peso(pd.estPayroll)}{pd.estPayroll !== pd.baseline && <div className={`delta ${pd.estPayroll > pd.baseline ? 'up' : 'down'}`}>{pd.estPayroll > pd.baseline ? '+' : '−'}{pesoShort(Math.abs(pd.estPayroll - pd.baseline))}</div>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td><b>People per day</b></td><td />{proj.perDay.map((d) => <td key={d.date} className="c"><b className="hc-n">{d.count}</b>{d.count !== d.baselineCount && <div className={`delta ${d.count > d.baselineCount ? 'up' : 'down'}`}>was {d.baselineCount}</div>}</td>)}<td /><td /></tr>
            <tr><td><b>Cost per day</b></td><td />{proj.perDay.map((d) => <td key={d.date} className="c small">{pesoShort(d.cost)}{d.cost !== d.baseline && <div className={`delta ${d.cost > d.baseline ? 'up' : 'down'}`}>{d.cost > d.baseline ? '+' : '−'}{pesoShort(Math.abs(d.cost - d.baseline))}</div>}</td>)}<td /><td className="num"><b>{peso(proj.periods.week.scenario)}</b></td></tr>
          </tfoot>
        </table>
      </section>
    </>
  );
}
