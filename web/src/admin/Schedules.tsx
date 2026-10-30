import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import { peso, todayIso } from '../api';
import { useApi } from '../hooks';
import { Avatar, Icon } from '../components/Icon';
import { projectHeadcount, type WeeklyPlan } from '../../../server/src/stats/workforce';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;

/** Weekly roster, head-count per department and the labor cost of each day — with a head-count planner. */
export default function Schedules() {
  const [start, setStart] = useState(() => DateTime.fromISO(todayIso()).startOf('week').toISODate()!);
  const plan = useApi<WeeklyPlan>(`/api/workforce/week?start=${start}`);
  const p = plan.data;
  const [counts, setCounts] = useState<Record<string, number[]>>({});
  const [editing, setEditing] = useState(false);
  const shift = (weeks: number) => { setStart(DateTime.fromISO(start).plus({ weeks }).toISODate()!); setCounts({}); };

  const baseline = useMemo(() => Object.fromEntries((p?.byDepartment ?? []).map((d) => [d.department, d.perDay.map((x) => x.count)])), [p]);
  const scenarioCounts = (dep: string) => counts[dep] ?? baseline[dep] ?? [];
  const projection = useMemo(() => (p ? projectHeadcount(p, counts) : null), [p, counts]);
  const changed = Object.entries(counts).some(([dep, arr]) => arr.some((n, i) => n !== baseline[dep]?.[i]));
  const setCount = (dep: string, i: number, n: number) => {
    const next = [...scenarioCounts(dep)];
    next[i] = Math.max(0, Math.min(99, n));
    setCounts({ ...counts, [dep]: next });
  };
  const allDays = (dep: string, delta: number) => setCounts({ ...counts, [dep]: scenarioCounts(dep).map((n) => Math.max(0, n + delta)) });

  const weekLabel = p ? `${DateTime.fromISO(p.weekStart).toFormat('d LLL')} – ${DateTime.fromISO(p.weekStart).plus({ days: 6 }).toFormat('d LLL yyyy')}` : '';
  const isThisWeek = start === DateTime.fromISO(todayIso()).startOf('week').toISODate();
  const departments = p?.byDepartment ?? [];
  const personDays = p?.totals.reduce((a, t) => a + t.count, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Schedules</h1>
        <div className="row" style={{ gap: '.4rem' }}>
          <button className="round-nav" onClick={() => shift(-1)} aria-label="Previous week"><Icon name="left" /></button>
          <b style={{ minWidth: 170, textAlign: 'center' }}>{weekLabel}</b>
          <button className="round-nav" onClick={() => shift(1)} aria-label="Next week"><Icon name="right" /></button>
          {!isThisWeek && <button className="btn sm" onClick={() => { setStart(DateTime.fromISO(todayIso()).startOf('week').toISODate()!); setCounts({}); }}>This week</button>}
        </div>
        <div className="spacer" />
        <Link className="pill-btn" to="/admin/settings"><Icon name="settings" />Shift templates</Link>
      </div>
      {plan.error && <div className="error">{plan.error}</div>}

      {p && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 14 }}>
            <div className="tile"><div className="v">{p.rows.length}</div><div className="k">Active employees · {departments.length} departments</div></div>
            <div className="tile"><div className="v">{(personDays / 7).toFixed(1)}</div><div className="k">Average people per day ({personDays} person-days)</div></div>
            <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{pesoShort(p.weekCost)}</div><div className="k">Labor cost this week</div></div>
            <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{pesoShort(p.monthCost)}</div><div className="k">Monthly run-rate · {pesoShort(p.yearCost)} / year</div></div>
          </div>

          {/* Weekly roster */}
          <section className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><h2>Weekly roster</h2><span className="spacer" /><span className="small">Shifts come from each employee's work schedule</span></div>
            <div className="table-wrap">
              <table className="roster">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {p.days.map((d, i) => (
                      <th key={d.date} className={`c ${d.holiday ? 'hol' : ''} ${d.date === todayIso() ? 'today' : ''}`}>
                        {DAY[i]} {d.date.slice(8)}{d.holiday && <div className="hol-name" title={d.holiday.name}>★ {d.holiday.type === 'regular' ? 'Holiday' : 'Special'}</div>}
                      </th>
                    ))}
                    <th className="num">Week cost</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dep) => (
                    <DepartmentRows key={dep.department} dep={dep.department} plan={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Head-count & cost per day */}
          <section className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div>
                <h2>Head-count per department</h2>
                <div className="small muted" style={{ marginTop: 2 }}>{editing ? 'Change the number of people per day to see what it costs.' : 'People scheduled per day and what each day costs.'}</div>
              </div>
              <span className="spacer" />
              {changed && <button className="btn sm" onClick={() => setCounts({})}>Reset to schedule</button>}
              <button className={`pill-btn ${editing ? 'solid' : ''}`} onClick={() => setEditing((e) => !e)}><Icon name={editing ? 'check' : 'plus'} />{editing ? 'Done editing' : 'Edit daily numbers'}</button>
            </div>
            <div className="table-wrap">
              <table className="hc">
                <thead>
                  <tr><th>Department</th>{p.days.map((d, i) => <th key={d.date} className={`c ${d.holiday ? 'hol' : ''}`}>{DAY[i]}</th>)}<th className="num">Cost / person-day</th>{editing && <th />}</tr>
                </thead>
                <tbody>
                  {departments.map((dep) => (
                    <tr key={dep.department}>
                      <td><b>{dep.department}</b><div className="muted small">{dep.people} on staff</div></td>
                      {dep.perDay.map((x, i) => {
                        const want = scenarioCounts(dep.department)[i] ?? x.count;
                        const delta = want - x.count;
                        return (
                          <td key={x.date} className="c">
                            {editing ? (
                              <div className="stepper">
                                <button onClick={() => setCount(dep.department, i, want - 1)} aria-label={`One less in ${dep.department} on ${DAY[i]}`} disabled={want <= 0}><Icon name="minus" /></button>
                                <input inputMode="numeric" value={want} aria-label={`${dep.department} on ${DAY[i]}`} onChange={(e) => setCount(dep.department, i, Number(e.target.value.replace(/\D/g, '')) || 0)} />
                                <button onClick={() => setCount(dep.department, i, want + 1)} aria-label={`One more in ${dep.department} on ${DAY[i]}`}><Icon name="plus" /></button>
                              </div>
                            ) : <span className="hc-n">{want}</span>}
                            {delta !== 0 && <div className={`delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? `+${delta}` : delta}</div>}
                          </td>
                        );
                      })}
                      <td className="num">{peso(dep.avgDailyCost)}</td>
                      {editing && (
                        <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <button className="btn sm" onClick={() => allDays(dep.department, -1)}>−1 daily</button>
                          <button className="btn sm" onClick={() => allDays(dep.department, 1)}>+1 daily</button>
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><b>People</b></td>
                    {projection?.perDay.map((d) => <td key={d.date} className="c"><b>{d.count}</b>{d.count !== d.baselineCount && <div className="muted small">was {d.baselineCount}</div>}</td>)}
                    <td />{editing && <td />}
                  </tr>
                  <tr>
                    <td><b>Cost per day</b><div className="muted small">wages + employer SSS/PhilHealth/Pag-IBIG + allowances</div></td>
                    {projection?.perDay.map((d) => (
                      <td key={d.date} className="c">
                        <b>{pesoShort(d.cost)}</b>
                        {Math.round(d.cost) !== Math.round(d.baseline) && <div className={`delta ${d.cost > d.baseline ? 'up' : 'down'}`}>{d.cost > d.baseline ? '+' : '−'}{pesoShort(Math.abs(d.cost - d.baseline))}</div>}
                      </td>
                    ))}
                    <td />{editing && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Projection */}
          {projection && (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Payroll projection</h2>
                  <div className="small muted" style={{ marginTop: 2 }}>{changed ? 'Your edited head-count compared with the current schedule.' : 'Current schedule. Edit the daily numbers above to compare a different head-count.'}</div>
                </div>
              </div>
              <div className="proj">
                {([['day', 'Per day (average)'], ['week', 'Per week'], ['month', 'Per month'], ['year', 'Per year']] as const).map(([k, label]) => {
                  const x = projection.periods[k];
                  const diff = x.difference;
                  return (
                    <div key={k} className={`proj-card ${diff < -0.5 ? 'save' : diff > 0.5 ? 'spend' : ''}`}>
                      <div className="k">{label}</div>
                      <div className="v">{pesoShort(x.scenario)}</div>
                      <div className="b">Current schedule {pesoShort(x.baseline)}</div>
                      <div className="d">{Math.abs(diff) < 0.5 ? 'No change' : diff < 0 ? `You save ${pesoShort(-diff)}` : `You spend ${pesoShort(diff)} more`}</div>
                    </div>
                  );
                })}
              </div>
              <p className="muted small" style={{ marginTop: 12 }}>
                How it's calculated: each person-day costs the daily wage (monthly salaries use the work-days factor in Settings) plus the employer share of SSS, PhilHealth and Pag-IBIG and any allowances, spread over working days. Regular holidays cost 200% and special days 130% of the wage.
                Removing people saves the average cost of those working that day; adding people uses the department's average. Month = week × 52 ÷ 12, year = week × 52. Overtime, night differential and penalties are not included.
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}

function DepartmentRows({ dep, plan }: { dep: string; plan: WeeklyPlan }) {
  const rows = plan.rows.filter((r) => r.department === dep);
  const depData = plan.byDepartment.find((d) => d.department === dep)!;
  return (
    <>
      <tr className="dep-row">
        <td colSpan={9}><b>{dep}</b> <span className="muted small">· {rows.length} {rows.length === 1 ? 'person' : 'people'} · {pesoShort(depData.perDay.reduce((a, x) => a + x.cost, 0))} this week</span></td>
      </tr>
      {rows.map((r) => (
        <tr key={r.employeeId}>
          <td>
            <Link to={`/admin/employees/${r.employeeId}`} className="row" style={{ gap: '.55rem', flexWrap: 'nowrap', color: 'var(--text)' }}>
              <Avatar name={r.name} photo={r.photoUrl} />
              <span><b>{r.name}</b><div className="muted small">{r.position} · {r.schedule}</div></span>
            </Link>
          </td>
          {r.cells.map((c) => (
            <td key={c.date} className="c">
              {c.working
                ? <span className={`shift ${c.dayType.includes('holiday') || c.dayType.includes('special') ? 'prem' : ''}`} title={`${peso(c.cost)} this day`}>{c.shift}</span>
                : <span className="shift off">Rest</span>}
            </td>
          ))}
          <td className="num">{peso(r.weekCost)}</td>
        </tr>
      ))}
    </>
  );
}
