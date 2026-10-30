import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, fmtDateTime, peso, todayIso } from '../api';
import { useApi } from '../hooks';
import { Icon, Portrait } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Stars, StarInput } from '../components/Stars';
import { BEHAVIOUR, COMPETENCIES, WEIGHTS } from '../../../server/src/stats/performance';

interface Review {
  id: string; periodStart: string; periodEnd: string; ratings: Record<string, number>;
  strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[]; notes: string | null;
  assists: number; employeeOfMonth: number; trainingCompleted: number; crossTrained: number; skillLevel: string | null; promotionReady: boolean; managerName: string | null; createdAt: string;
}
interface Perf {
  period: { from: string; to: string };
  employee: { id: string; employeeNo: string; name: string; position: string | null; department: string | null; hireDate: string | null; active: boolean; photoUrl: string | null; location: string; payType: string };
  card: null | {
    overall: number; tier: string;
    performance: {
      scores: { overall: number; stars: number; label: string; components: Record<keyof typeof WEIGHTS, number | null>; salesIndex: number | null };
      rank: { position: number; of: number };
      input: {
        attendance: { scheduledDays: number; daysPresent: number; daysAbsent: number; lateCount: number; lateMinutes: number; overtimeMinutes: number };
        leaveDays: number; approvedPenalties: number; penaltyAmount: number; warnings: number; compliments: number;
        sales: { orders: number; salesComms: number; lds: number; po: number; daysWithData: number } | null;
      };
    };
  };
  review: Review | null;
}

const PERIODS = [
  { key: 'month', label: 'This month', range: () => [DateTime.fromISO(todayIso()).startOf('month'), DateTime.fromISO(todayIso())] },
  { key: '3m', label: 'Last 3 months', range: () => [DateTime.fromISO(todayIso()).minus({ months: 3 }).plus({ days: 1 }), DateTime.fromISO(todayIso())] },
  { key: '6m', label: 'Last 6 months', range: () => [DateTime.fromISO(todayIso()).minus({ months: 6 }).plus({ days: 1 }), DateTime.fromISO(todayIso())] },
  { key: 'year', label: 'This year', range: () => [DateTime.fromISO(todayIso()).startOf('year'), DateTime.fromISO(todayIso())] },
] as const;
const WEIGHT_LABEL: Record<keyof typeof WEIGHTS, string> = { attendance: 'Attendance', punctuality: 'Punctuality', sales: 'Sales', discipline: 'Discipline', teamwork: 'Teamwork' };
const fmtDate = (d: string | null) => (d ? DateTime.fromISO(d).toFormat('LLL d, yyyy') : '—');
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Employee performance summary: the visual card from a click on an Employee card. */
export default function EmployeePerformance() {
  const { id } = useParams();
  const [period, setPeriod] = useState<typeof PERIODS[number]['key']>('month');
  const [from, to] = useMemo(() => PERIODS.find((p) => p.key === period)!.range().map((d) => d.toISODate()!), [period]);
  const perf = useApi<Perf>(`/api/employees/${id}/performance?from=${from}&to=${to}`);
  const [reviewing, setReviewing] = useState(false);
  const p = perf.data;
  if (perf.error) return <div className="error">{perf.error}</div>;
  if (!p || !p.card) return <div className="muted">Loading…</div>;
  const s = p.card.performance.scores;
  const i = p.card.performance.input;
  const a = i.attendance;
  const r = p.review;
  const rank = p.card.performance.rank;
  const sales = i.sales;
  const perDay = (n: number) => (a.daysPresent ? r1(n / a.daysPresent) : 0);
  const behaviour = (k: string) => (r?.ratings[k] ? Math.round(r.ratings[k] * 20) : null);

  return (
    <div className="perf">
      <div className="page-head">
        <Link to="/admin/performance" className="round-nav" aria-label="Back to Employee cards"><Icon name="left" /></Link>
        <div>
          <h1>Employee performance card</h1>
          <div className="muted small">Performance summary · {fmtDate(from)} – {fmtDate(to)}</div>
        </div>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Period">{PERIODS.map((x) => <button key={x.key} className={period === x.key ? 'on' : ''} onClick={() => setPeriod(x.key)}>{x.label}</button>)}</div>
        <button className="btn primary" onClick={() => setReviewing(true)}><Icon name="plus" /> New review</button>
      </div>

      {/* Header: photo · details · overall */}
      <div className="perf-top">
        <section className="card perf-id">
          <Portrait name={p.employee.name} photo={p.employee.photoUrl} className="perf-photo" />
          <div className="perf-name">{p.employee.name}</div>
          <div className="muted">{p.employee.position}</div>
        </section>
        <section className="card perf-info">
          <dl className="kv big">
            <dt>Employee ID</dt><dd>{p.employee.employeeNo}</dd>
            <dt>Department</dt><dd>{p.employee.department ?? '—'}</dd>
            <dt>Date hired</dt><dd>{fmtDate(p.employee.hireDate)}</dd>
            <dt>Manager</dt><dd>{r?.managerName ?? '—'}</dd>
            <dt>Work location</dt><dd>{p.employee.location}</dd>
            <dt>Employment status</dt><dd>{p.employee.active ? 'Active' : 'Passive'} · {p.employee.payType === 'monthly' ? 'Monthly paid' : 'Daily paid'}</dd>
          </dl>
        </section>
        <section className="card perf-overall">
          <div className="k">Overall performance</div>
          <div className="score"><b>{s.overall.toFixed(1)}</b><span>/100</span></div>
          <Stars value={s.stars} size={26} />
          <div className="lbl">{s.label}</div>
          <div className="rank"><span>Rank</span><b>{rank.position === 1 ? 'Top performer' : `#${rank.position} of ${rank.of}`}</b></div>
          <div className="muted small">{rank.position === 1 ? `#1 of ${rank.of} in ${p.employee.department}` : `in ${p.employee.department}`}</div>
        </section>
      </div>

      {/* KPI tiles */}
      <div className="kpis">
        <Kpi tone="att" title="Attendance" icon="calendar" big={a.daysPresent} bigLabel="Days attended" small={pct(s.components.attendance)} smallLabel="Attendance %" />
        <Kpi tone="pun" title="Punctuality" icon="clock" big={a.lateCount} bigLabel="Late arrivals" small={String(a.lateMinutes)} smallLabel="Late minutes" />
        <Kpi tone="lea" title="Leave" icon="wallet" big={i.leaveDays} bigLabel="Days on leave" small={a.scheduledDays ? `${r1((a.daysAbsent / a.scheduledDays) * 100)}%` : '—'} smallLabel="Absenteeism rate" />
        <Kpi tone="dis" title="Discipline" icon="scale" big={i.warnings} bigLabel="Warnings" small={String(i.approvedPenalties)} smallLabel="Policy violations" />
        <Kpi tone="rec" title="Recognition" icon="trophy" big={r?.employeeOfMonth ?? 0} bigLabel="Employee of the month" small={String(i.compliments)} smallLabel="Management compliments" />
      </div>

      <div className="perf-3">
        <Panel tone="att" title="Work performance">
          <Row k="Orders processed" v={sales ? sales.orders.toLocaleString() : '—'} />
          <Row k="Sales comms. (packages)" v={sales ? sales.salesComms : '—'} />
          <Row k="LD's" v={sales ? sales.lds : '—'} />
          <Row k="PO" v={sales ? sales.po : '—'} />
          <Row k="Days with sales recorded" v={sales ? sales.daysWithData : '—'} />
          <Row k="Penalty deductions" v={peso(i.penaltyAmount)} />
        </Panel>
        <Panel tone="pun" title="Sales performance">
          <Row k="Orders per working day" v={sales ? perDay(sales.orders) : '—'} />
          <Row k="LD's per working day" v={sales ? perDay(sales.lds) : '—'} />
          <Row k="Packages per week" v={sales ? r1((sales.salesComms / Math.max(1, a.daysPresent)) * 5) : '—'} />
          <Row k="Sales score" v={s.components.sales === null ? '—' : `${Math.round(s.components.sales)}/100`} />
          <Row k="Rank in department" v={`#${rank.position} of ${rank.of}`} />
          <Row k="Overtime" v={`${Math.round(a.overtimeMinutes / 60)} h`} />
        </Panel>
        <Panel tone="rec" title="Team & behaviour">
          <Row k="Assists (helped co-workers)" v={r?.assists ?? '—'} />
          <Row k="Leadership score" v={behaviour('leadership') === null ? '—' : `${behaviour('leadership')}/100`} />
          {BEHAVIOUR.filter((b) => b.key !== 'leadership').map((b) => <Row key={b.key} k={b.label} v={behaviour(b.key) === null ? '—' : `${behaviour(b.key)}%`} />)}
        </Panel>
      </div>

      <div className="perf-3">
        <Panel tone="att" title="Efficiency calculator">
          {(Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => {
            const v = s.components[k];
            return (
              <div className="eff-row" key={k}>
                <span>{WEIGHT_LABEL[k]} ({Math.round(WEIGHTS[k] * 100)}%)</span>
                <span className={`eff-bar ${k}`}><i style={{ width: `${v ?? 0}%` }} /></span>
                <b>{v === null ? '—' : Math.round(v)}</b>
              </div>
            );
          })}
          <div className="eff-total"><span>Efficiency score</span><b>{s.overall.toFixed(1)}</b><span className="muted">/100</span></div>
        </Panel>
        <Panel tone="pun" title="Core competencies">
          {COMPETENCIES.map((c) => (
            <div className="comp-row" key={c.key}><span>{c.label}</span>{r?.ratings[c.key] ? <Stars value={r.ratings[c.key]} /> : <span className="muted small">Not rated</span>}</div>
          ))}
        </Panel>
        <Panel tone="rec" title="Skills & training">
          <Row k="Training completed" v={r?.trainingCompleted ?? '—'} />
          <Row k="Cross-trained departments" v={r?.crossTrained ?? '—'} />
          <Row k="Skill level" v={<b className="accent-text">{r?.skillLevel ?? '—'}</b>} />
          <Row k="Promotion ready" v={r ? <b className={r.promotionReady ? 'good-text' : ''}>{r.promotionReady ? 'Yes' : 'Not yet'}</b> : '—'} />
        </Panel>
      </div>

      <div className="swot">
        {([['Strengths', 'good', r?.strengths], ['Weaknesses', 'lea', r?.weaknesses], ['Opportunities', 'att', r?.opportunities], ['Threats', 'dis', r?.threats]] as const).map(([t, tone, items]) => (
          <section key={t} className={`card swot-card tone-${tone}`}>
            <h3>{t}</h3>
            {items?.length ? <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted small">Add in a review.</p>}
          </section>
        ))}
      </div>

      <section className="card perf-foot">
        <div>
          <div className="k">Manager's notes</div>
          <p>{r?.notes ?? <span className="muted">No review yet. Click “New review” to rate this employee on the 5-star scale.</span>}</p>
        </div>
        <div className="period">
          <Icon name="calendar" />
          <div><div className="k">Review period</div><b>{r ? `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` : '—'}</b><div className="muted small">{r ? `Reviewed ${fmtDateTime(r.createdAt)}` : ''}</div></div>
        </div>
        <div className="sign">
          <div className="k">Manager signature</div>
          <div className="signature">{r?.managerName ?? ''}</div>
          <div className="muted small">{r ? `Date: ${fmtDate(r.periodEnd)}` : ''}</div>
        </div>
      </section>

      {reviewing && <ReviewForm employeeId={p.employee.id} name={p.employee.name} previous={r} onClose={() => setReviewing(false)} onSaved={async () => { setReviewing(false); await perf.reload(); }} />}
    </div>
  );
}

function Kpi({ tone, title, icon, big, bigLabel, small, smallLabel }: { tone: string; title: string; icon: 'calendar' | 'clock' | 'wallet' | 'scale' | 'trophy'; big: number | string; bigLabel: string; small: string; smallLabel: string }) {
  return (
    <section className={`kpi tone-${tone}`}>
      <div className="kpi-head">{title}</div>
      <div className="kpi-ico"><Icon name={icon} /></div>
      <div className="kpi-l">{bigLabel}</div>
      <div className="kpi-big">{big}</div>
      <div className="kpi-l">{smallLabel}</div>
      <div className="kpi-small">{small}</div>
    </section>
  );
}
function Panel({ tone, title, children }: { tone: string; title: string; children: React.ReactNode }) {
  return <section className={`card panel tone-${tone}`}><div className="panel-head">{title}</div><div className="panel-body">{children}</div></section>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="kv-row"><span>{k}</span><b>{v}</b></div>;
}

function ReviewForm({ employeeId, name, previous, onClose, onSaved }: { employeeId: string; name: string; previous: Review | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const today = DateTime.fromISO(todayIso());
  const [f, setF] = useState({
    periodStart: today.startOf('month').minus({ months: 2 }).toISODate()!, periodEnd: today.toISODate()!,
    ratings: { ...(previous?.ratings ?? {}) } as Record<string, number>,
    strengths: (previous?.strengths ?? []).join('\n'), weaknesses: (previous?.weaknesses ?? []).join('\n'),
    opportunities: (previous?.opportunities ?? []).join('\n'), threats: (previous?.threats ?? []).join('\n'),
    notes: '', assists: previous?.assists ?? 0, employeeOfMonth: previous?.employeeOfMonth ?? 0,
    trainingCompleted: previous?.trainingCompleted ?? 0, crossTrained: previous?.crossTrained ?? 0,
    skillLevel: previous?.skillLevel ?? 'Intermediate', promotionReady: previous?.promotionReady ?? false, managerName: previous?.managerName ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const rate = (k: string, v: number) => setF({ ...f, ratings: { ...f.ratings, [k]: v } });
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const ratings = Object.fromEntries(Object.entries(f.ratings).filter(([, v]) => v > 0));
      await api.post(`/api/employees/${employeeId}/reviews`, { ...f, ratings, strengths: lines(f.strengths), weaknesses: lines(f.weaknesses), opportunities: lines(f.opportunities), threats: lines(f.threats), managerName: f.managerName || null, notes: f.notes || null });
      await onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Performance review · ${name}`} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save review'}</button>
    </>}>
      <div className="review-form">
        <div className="form-grid">
          <label className="field">From<input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></label>
          <label className="field">To<input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></label>
        </div>
        <h3>Core competencies</h3>
        {COMPETENCIES.map((c) => <div className="rate-row" key={c.key}><span>{c.label}</span><StarInput label={c.label} value={f.ratings[c.key] ?? 0} onChange={(v) => rate(c.key, v)} /></div>)}
        <h3>Team & behaviour</h3>
        {BEHAVIOUR.map((c) => <div className="rate-row" key={c.key}><span>{c.label}</span><StarInput label={c.label} value={f.ratings[c.key] ?? 0} onChange={(v) => rate(c.key, v)} /></div>)}
        <h3>Recognition, skills & training</h3>
        <div className="form-grid">
          <label className="field">Assists (helped co-workers)<input type="number" min={0} value={f.assists} onChange={(e) => setF({ ...f, assists: Number(e.target.value) })} /></label>
          <label className="field">Employee of the month (times)<input type="number" min={0} value={f.employeeOfMonth} onChange={(e) => setF({ ...f, employeeOfMonth: Number(e.target.value) })} /></label>
          <label className="field">Training completed<input type="number" min={0} value={f.trainingCompleted} onChange={(e) => setF({ ...f, trainingCompleted: Number(e.target.value) })} /></label>
          <label className="field">Cross-trained departments<input type="number" min={0} value={f.crossTrained} onChange={(e) => setF({ ...f, crossTrained: Number(e.target.value) })} /></label>
          <label className="field">Skill level<select value={f.skillLevel} onChange={(e) => setF({ ...f, skillLevel: e.target.value })}>{['Beginner', 'Intermediate', 'Advanced', 'Expert'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field">Manager signature (name)<input value={f.managerName} onChange={(e) => setF({ ...f, managerName: e.target.value })} placeholder="Your name" /></label>
        </div>
        <label className="row small" style={{ gap: '.35rem', marginTop: 8 }}><input type="checkbox" checked={f.promotionReady} onChange={(e) => setF({ ...f, promotionReady: e.target.checked })} />Promotion ready</label>
        <h3>SWOT (one per line)</h3>
        <div className="form-grid">
          {(['strengths', 'weaknesses', 'opportunities', 'threats'] as const).map((k) => (
            <label key={k} className="field" style={{ textTransform: 'capitalize' }}>{k}<textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
        </div>
        <label className="field" style={{ marginTop: 8 }}>Manager's notes<textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {error && <div className="error">{error}</div>}
      </div>
    </Modal>
  );
}
