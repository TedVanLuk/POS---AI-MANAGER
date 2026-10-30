import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtTime, hm, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Avatar, Icon } from '../components/Icon';
import { Burst, HoursBars, LatesLine, Ring, type DayPoint } from '../components/DashCharts';
import type { CardData } from '../components/EmployeeCard';

interface Dash {
  activeEmployees: number; attendanceRate: number | null; pendingPenalties: number;
  last14: { lateCount: number; lateMinutes: number; overtimeMinutes: number; daysAbsent: number; daysPresent: number; scheduledDays: number };
  lastRun: { id: string; periodStart: string; periodEnd: string; status: string; net: number } | null;
  trend: DayPoint[];
  cutoff: { start: string; end: string; elapsedPct: number; daysLeft: number; run: { id: string; status: string } | null };
  overtime: { employeeId: string; name: string; position: string | null; minutes: number; days: number; amount: number }[];
  alerts: { pendingPenalties: number; missingTimeouts: number; missingSerials: number; notEnrolled: number };
}
interface Today {
  date: string; counts: { total: number; clockedIn: number; late: number; notIn: number };
  feed: { id: string; employeeId: string; type: 'in' | 'out'; punchedAt: string; method: string; name?: string }[];
  rows: { employeeId: string; name: string; position: string | null; photoUrl?: string | null; status: string; record: { lateMinutes: number; firstIn: string | null } }[];
}

const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default function Dashboard() {
  const { me } = useAuth();
  const nav = useNavigate();
  const dash = useApi<Dash>('/api/dashboard');
  const today = useApi<Today>('/api/attendance/today');
  const cards = useApi<CardData[]>('/api/stats/cards?days=30');
  const [range, setRange] = useState<7 | 14>(14);
  const [page, setPage] = useState(0);
  const d = dash.data;
  const t = today.data;
  const top = cards.data?.[0];
  const topRow = t?.rows.find((r) => r.employeeId === top?.employeeId);

  // Team strip: people on shift first.
  const team = [...(t?.rows ?? [])].sort((a, b) => Number(b.status === 'in') - Number(a.status === 'in'));
  const PER = 6;
  const pages = Math.max(1, Math.ceil(team.length / PER));

  const onTime = d ? d.trend.reduce((a, x) => a + x.present - x.late, 0) : 0;
  const late = d ? d.trend.reduce((a, x) => a + x.late, 0) : 0;
  const absent = d ? d.trend.reduce((a, x) => a + x.absent, 0) : 0;
  const mixTotal = onTime + late + absent;
  const trend = d ? d.trend.slice(-range) : [];
  const hours = trend.reduce((a, x) => a + x.workedHours, 0);
  const lates14 = d ? d.trend.reduce((a, x) => a + x.late, 0) : 0;
  const lateDays = d ? d.trend.filter((x) => x.late > 0).length : 0;

  const attention = d ? [
    { label: `${d.alerts.pendingPenalties} penalties to review`, to: '/admin/penalties', hot: d.alerts.pendingPenalties > 0, x: 2, y: 8, r: -12 },
    { label: d.cutoff.run ? `Payroll ${short(d.cutoff.start)}–${short(d.cutoff.end)} · ${d.cutoff.run.status}` : `Payroll ${short(d.cutoff.start)}–${short(d.cutoff.end)} not started`, to: d.cutoff.run ? `/admin/payroll/${d.cutoff.run.id}` : '/admin/payroll', hot: !d.cutoff.run, x: 36, y: 6, r: 6 },
    { label: `${d.alerts.missingSerials} missing OS serials`, to: '/admin/efficiency', hot: d.alerts.missingSerials > 0, x: 8, y: 44, r: 4 },
    { label: `${d.alerts.missingTimeouts} missing time-outs`, to: '/admin/attendance', hot: d.alerts.missingTimeouts > 0, x: 50, y: 40, r: -16 },
    { label: d.alerts.notEnrolled ? `${d.alerts.notEnrolled} without fingerprint` : 'All fingerprints enrolled', to: '/admin/employees', hot: d.alerts.notEnrolled > 0, x: 4, y: 76, r: -4 },
    { label: `${d.last14.lateCount} lates · 14 days`, to: '/admin/attendance', hot: false, x: 52, y: 74, r: 10 },
  ] : [];

  return (
    <>
      <div className="welcome">
        <div>
          <h1>Welcome in, {me?.name.split(' ')[0]}</h1>
          <div className="sub">{d ? `${d.activeEmployees} members` : '…'} · {t ? `${t.counts.clockedIn} on shift now` : ''}</div>
        </div>
        <div className="avatar-strip" aria-label="Team">
          <button className="round-nav" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous team members"><Icon name="left" /></button>
          {team.slice(page * PER, page * PER + PER).map((r) => (
            <Avatar key={r.employeeId} name={r.name} photo={r.photoUrl} online={r.status === 'in'} title={`${r.name} · ${r.status === 'in' ? 'on shift' : r.status.replace('_', ' ')}`} onClick={() => nav(`/admin/employees/${r.employeeId}`)} />
          ))}
          <button className="round-nav" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next team members"><Icon name="right" /></button>
        </div>
        <div className="end">
          {isAdmin(me?.role) && <button className="pill-btn" onClick={() => nav('/admin/employees?add=1')}><Icon name="plus" />Add employee</button>}
        </div>
      </div>
      {(dash.error || today.error) && <div className="error" style={{ marginBottom: 12 }}>{dash.error ?? today.error}</div>}

      <div className="dash">
        {/* Top performer */}
        <section className="card d-hero" aria-label="Top performer">
          <div className="hero-photo">
            <span className="chip l"><i style={{ background: topRow?.status === 'in' ? 'var(--accent)' : 'var(--text-3)' }} />{topRow?.status === 'in' ? 'ON SHIFT' : 'OFF SHIFT'}</span>
            <span className="chip r">Top performer · 30 days</span>
            {top?.photoUrl
              ? <img className="hero-img" src={top.photoUrl} alt={`Photo of ${top.name}`} />
              : <span className="mono" aria-hidden>{top ? top.name.split(' ').map((p) => p[0]).slice(0, 2).join('') : ''}</span>}
          </div>
          <div className="hero-body">
            <div className="nm">{top?.name ?? '—'}{top && <Link to={`/admin/employees/${top.employeeId}`} aria-label="Open profile"><Icon name="arrowUpRight" /></Link>}</div>
            <div className="role">{top?.position} · OVR {top?.overall} · <span style={{ textTransform: 'capitalize' }}>{top?.tier}</span></div>
            <div className="stats">
              <span><b>{top?.attributes.PUN ?? '—'}</b>Punctuality</span>
              <span><b>{top?.attributes.ATT ?? '—'}</b>Attendance</span>
              <span><b>{top?.attributes.DIS ?? '—'}</b>Discipline</span>
            </div>
          </div>
        </section>

        {/* Overtime this cutoff */}
        <section className="card d-movers">
          <div className="card-head"><h2>Overtime this cutoff</h2><span className="spacer" /><Link to="/admin/attendance" className="small">All</Link></div>
          <div className="list">
            {d?.overtime.length === 0 && <div className="muted small">No overtime recorded since {short(d.cutoff.start)}.</div>}
            {d?.overtime.map((o) => (
              <Link key={o.employeeId} to={`/admin/employees/${o.employeeId}`} className="list-row">
                <span className="sq"><Icon name="clock" /></span>
                <span style={{ minWidth: 0 }}><div className="t">{o.name}</div><div className="s"><Icon name="clock" />{hm(o.minutes)} · {o.days} day{o.days === 1 ? '' : 's'}</div></span>
                <span className="plus">+{peso(o.amount).replace('.00', '')}</span>
              </Link>
            ))}
          </div>
          {d && d.overtime.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>Estimated OT pay at 125%–338% premiums, {short(d.cutoff.start)} to today.</div>}
        </section>

        {/* Attendance mix */}
        <section className="card d-mix">
          <div className="card-head"><h2>Attendance mix</h2><span className="spacer" /><span className="small">14 days</span></div>
          <div className="mix-wrap">
            <Burst parts={[
              { value: onTime, color: 'var(--series-1)', label: 'On time' },
              { value: late, color: 'var(--series-2)', label: 'Late' },
              { value: absent, color: 'var(--series-3)', label: 'Absent' },
            ]} size={190} />
            <div className="big"><b>{d?.attendanceRate != null ? `${Math.round(d.attendanceRate * 100)}%` : '—'}</b><span>attendance</span></div>
          </div>
          <div className="mix-legend">
            {[['On time', onTime, 'var(--series-1)'], ['Late', late, 'var(--series-2)'], ['Absent', absent, 'var(--series-3)']].map(([label, v, color]) => (
              <div className="r" key={label as string}><i style={{ background: color as string }} /><span>{label}</span><span className="c">{v}/{mixTotal}</span><span className="p">{pct(v as number, mixTotal)}%</span></div>
            ))}
          </div>
        </section>

        {/* Right column */}
        <div className="d-right">
          <section className="card">
            <div className="card-head">
              <div><div className="small muted">{lateDays}/{d?.trend.length ?? 14} days with lates</div><h2 style={{ marginTop: 2 }}>{lates14} late arrivals</h2></div>
            </div>
            {d && <LatesLine data={d.trend} />}
          </section>

          <section className="card">
            {d && (
              <Link to={d.cutoff.run ? `/admin/payroll/${d.cutoff.run.id}` : '/admin/payroll'} className="ring-card" style={{ color: 'var(--text)' }}>
                <Ring pct={d.cutoff.elapsedPct} />
                <span>
                  <div className="kicker">Pay period · {d.cutoff.daysLeft} day{d.cutoff.daysLeft === 1 ? '' : 's'} left</div>
                  <div className="ttl">{short(d.cutoff.start)} – {short(d.cutoff.end)} payroll {d.cutoff.run ? `is in ${d.cutoff.run.status}` : 'not created yet'}</div>
                </span>
              </Link>
            )}
            <div className="timeline">
              {t?.feed.length === 0 && <div className="muted small" style={{ padding: '.6rem 0' }}>No punches yet today. They appear here as staff scan in.</div>}
              {t?.feed.slice(0, 5).map((p) => {
                const row = t.rows.find((r) => r.employeeId === p.employeeId);
                const lateMin = p.type === 'in' ? row?.record.lateMinutes ?? 0 : 0;
                return (
                  <Link key={p.id} to={`/admin/employees/${p.employeeId}`} className="tl-row" style={{ color: 'var(--text)' }}>
                    <span className={`tl-dot ${p.type === 'in' ? 'in' : ''}`}><Icon name={p.type === 'in' ? 'check' : 'out'} /></span>
                    <span><div className="t">{p.name} {p.type === 'in' ? 'timed in' : 'timed out'}</div><div className="s">{row?.position}{lateMin ? ` · late ${lateMin} min` : ''}{p.method !== 'fingerprint' ? ` · ${p.method}` : ''}</div></span>
                    <time>{fmtTime(p.punchedAt)}</time>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="promo">
            <div className="top"><span className="logo-dot" aria-hidden /><button className="go" onClick={() => nav(isAdmin(me?.role) ? '/admin/ai' : '/kiosk')}>{isAdmin(me?.role) ? 'Ask now' : 'Open'} <Icon name="arrowUpRight" /></button></div>
            <h3>{isAdmin(me?.role) ? 'AI Manager' : 'Time clock'}</h3>
            <p>{isAdmin(me?.role) ? 'Ask about lates, overtime, payroll changes and who needs coaching, in plain language.' : 'Open the fingerprint kiosk on this device.'}</p>
          </section>
        </div>

        {/* KPI tiles */}
        <div className="d-tiles">
          <div className="tile"><div className="v">{t ? t.counts.clockedIn : '—'}<span className="muted" style={{ fontSize: '1.1rem' }}>/{t?.counts.total ?? ''}</span></div><div className="k">On shift now</div></div>
          <div className="tile"><div className="v">{t ? t.counts.late : '—'}</div><div className="k">Late today</div></div>
        </div>

        {/* Labor hours */}
        <section className="card d-hours">
          <div className="card-head">
            <div>
              <h2>Labor hours</h2>
              <div className="small muted" style={{ marginTop: 2 }}>{trend.length ? `${short(trend[0].date)} – ${short(trend[trend.length - 1].date)}` : ''} · {Math.round(hours).toLocaleString('en-PH')} h total · {d ? hm(d.last14.overtimeMinutes) : ''} OT (14 days)</div>
            </div>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Range">
              {([7, 14] as const).map((n) => <button key={n} className={range === n ? 'on' : ''} onClick={() => setRange(n)}>{n}D</button>)}
            </div>
          </div>
          {d && <HoursBars key={range} data={trend} />}
        </section>

        {/* Needs attention */}
        <section className="card d-attn">
          <div className="card-head"><h2>Needs attention</h2><span className="spacer" /><Link to="/admin/penalties" className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Open penalties"><Icon name="arrowUpRight" /></Link></div>
          <div className="chips-cloud">
            {attention.map((a) => (
              <Link key={a.label} to={a.to} className={a.hot ? 'hot' : 'ok'} style={{ transform: `rotate(${a.r / 2.5}deg)` }}>{a.label}</Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
