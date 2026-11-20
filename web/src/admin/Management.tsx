import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, peso, todayIso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Avatar, Icon } from '../components/Icon';
import { ConfirmDialog, Modal } from '../components/Modal';
import { CATEGORIES, SCORE_LABEL, STEPS, type Analysis, type ReviewInput } from '../../../server/src/mgmt/sevenstep';
import type { ResolvedRole } from '../../../server/src/policy/jobs';
import { Hierarchy, RoleEditor, type RolesRes } from './CompanyPolicy';

const TABS = [['chart', 'Organizational chart'], ['system', '7-Step Management System'], ['reviews', 'Daily reviews'], ['control', 'Team categories']] as const;
type Tab = typeof TABS[number][0];

/** Management: the organizational chart and the 7-Step Management System used by heads and supervisors. */
export default function Management() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'chart';
  const nav = useNavigate();
  return (
    <>
      <div className="page-head">
        <div><h1>Management</h1><div className="muted small">Who leads whom, and how every head of department and supervisor reviews their team</div></div>
        <div className="spacer" />
        {tab !== 'chart' && <button className="btn primary" onClick={() => nav('/admin/management/review')}><Icon name="plus" /> New 7-step review</button>}
      </div>
      <div className="tabs" role="tablist" aria-label="Management">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams(k === 'chart' ? {} : { tab: k }, { replace: true })}>{l}</button>)}
      </div>
      {tab === 'chart' && <OrgChart />}
      {tab === 'system' && <SystemGuide />}
      {tab === 'reviews' && <Reviews />}
      {tab === 'control' && <Control />}
    </>
  );
}

// ---------------------------------------------------------------- organizational chart
function OrgChart() {
  const { me } = useAuth();
  const roles = useApi<RolesRes>('/api/policy/roles');
  const [view, setView] = useState<'chart' | 'list'>(() => (window.innerWidth < 760 ? 'list' : 'chart'));
  const [showStaff, setShowStaff] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [fit, setFit] = useState(true);
  const [editing, setEditing] = useState<ResolvedRole | null>(null);
  const nav = useNavigate();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const admin = isAdmin(me?.role);

  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => { const w = i.scrollWidth; setZoom(fit && w > 0 ? Math.min(1, (o.clientWidth - 8) / w) : 1); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, [fit, roles.data, showStaff, showOff, view]);

  if (roles.error) return <div className="error">{roles.error}</div>;
  if (!roles.data) return <div className="muted">Loading…</div>;
  const all = roles.data.roles;
  const visible = (r: ResolvedRole) => (showStaff || r.tier !== 'staff' || r.onChart) && (showOff || r.onChart);
  const kids = (key: string) => all.filter((r) => r.reportsTo === key && visible(r)).sort((a, b) => (a.no ?? 0) - (b.no ?? 0) || a.order - b.order);
  const titleOf = (k: string) => all.find((r) => r.key === k);
  const people = (r: ResolvedRole) => (r.key.startsWith('staff:') && r.department ? roles.data!.headcount[r.department] ?? 0 : null);

  const Card = ({ r }: { r: ResolvedRole }) => {
    const n = people(r);
    return (
      <div className={`oc-card t-${r.tier} ${r.onChart ? '' : 'off'}`}>
        <button className="oc-main" onClick={() => nav(`/admin/policy/jobs/${encodeURIComponent(r.key)}`)} title={`${r.title} — open job description`}>
          {r.no && <span className="oc-no">{r.no}.</span>}
          <span className="oc-name">{r.tier === 'team' ? r.title.toUpperCase() : (r.holder ?? 'Vacant').toUpperCase()}</span>
          <span className="oc-title">{r.tier === 'team' ? r.holder ?? '' : r.title}</span>
          {n !== null && <span className="oc-meta">{n} {n === 1 ? 'person' : 'people'}</span>}
          {r.also.length > 0 && <span className="oc-meta">also reports to {r.also.map((k) => titleOf(k)?.holder ?? titleOf(k)?.title).join(', ')}</span>}
        </button>
        {admin && <button className="oc-edit" onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`}><Icon name="dots" /></button>}
      </div>
    );
  };
  const Branch = ({ r }: { r: ResolvedRole }): JSX.Element => {
    const c = kids(r.key);
    // A long row of people with no one under them is stacked, to keep the chart readable.
    const stack = c.length >= 3 && c.every((x) => kids(x.key).length === 0);
    return <li><Card r={r} />{c.length > 0 && <ul className={stack ? 'stack' : ''}>{c.map((x) => <Branch key={x.key} r={x} />)}</ul>}</li>;
  };
  const roots = all.filter((r) => !r.reportsTo);

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="View">
          <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Chart</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        </div>
        {view === 'chart' && <>
          <label className="row small" style={{ gap: '.35rem' }}><input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />Fit to screen</label>
          <label className="row small" style={{ gap: '.35rem' }}><input type="checkbox" checked={showStaff} onChange={(e) => setShowStaff(e.target.checked)} />Show staff under each head</label>
          <label className="row small" style={{ gap: '.35rem' }}><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Show roles not on the chart</label>
        </>}
        <div className="spacer" />
        <span className="muted small">Click a box for the job description{admin ? '; ⋯ to change who holds it or who they report to' : ''}.</span>
      </div>
      {view === 'list' ? <Hierarchy vertical /> : (
        <div className="card oc-wrap" ref={outer}>
          <div className="oc" ref={inner} style={{ zoom }}>
            <ul>{roots.map((r) => <Branch key={r.key} r={r} />)}</ul>
          </div>
        </div>
      )}
      {view === 'chart' && (
        <div className="legend" style={{ marginTop: 10 }}>
          <span><i className="lg t-executive" />Owner, GM & managers</span>
          <span><i className="lg t-supervisor" />Supervisors & admin</span>
          <span><i className="lg t-head" />Heads of department (1–14)</span>
          <span><i className="lg t-team" />Teams</span>
          {showOff && <span><i className="lg off" />Not on the chart — placed by the system</span>}
        </div>
      )}
      {editing && <RoleEditor role={editing} roles={roles.data} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await roles.reload(); }} />}
    </>
  );
}

// ---------------------------------------------------------------- the system (training guide)
const HOW: Record<number, { how: string; inApp: string }> = {
  1: { how: 'At call time, give each specialist a clear task list for the night. At the end of the shift count what was done.', inApp: 'Enter tasks assigned and completed — the score is suggested from the completion rate (100% Excellent · 85% Good · 60% Bad · below Terrible).' },
  2: { how: 'Judge how well the completed tasks were done — guest feedback, standards, mistakes. Never mix it with how much was done.', inApp: 'Pick Excellent / Good / Bad / Terrible and add a short note.' },
  3: { how: 'Scheduled hours vs actual productive hours. Being clocked in is not the same as working: note breaks taken, idle time, leaving the station.', inApp: 'Scheduled hours come from the shift; worked hours from the fingerprint clock. Adjust productive hours and note the gap.' },
  4: { how: 'Non-financial outcomes: table turn time, order accuracy, waste %, upsell rate. Always Plan vs Fact.', inApp: 'Each department has its own metrics. For servers, orders, LD’s and packages come from the Servers tracker, with the 4-week average as the plan.' },
  5: { how: 'Revenue generated vs plan, and what the person cost the company that day.', inApp: 'Sales come from order slips where available; cost is the person’s daily rate. Margin = revenue − cost.' },
  6: { how: 'Steps 1 and 3 show effort (hard working or lazy). Steps 2, 4 and 5 show results (good or poor). Put the two together.', inApp: 'The system suggests the category. For poor results with hard work, it checks the history: 3 poor reviews in a row without improvement suggests Category 4.' },
  7: { how: 'One specific, doable plan for tomorrow. Write it as Result > Analysis > Action.', inApp: 'The action plan is required; it shows on the next review as yesterday’s plan to check.' },
};
export function CategoryBadge({ n, small }: { n: number; small?: boolean }) {
  const c = CATEGORIES[n - 1];
  return <span className={`cat cat-${n} ${small ? 'sm' : ''}`} title={`${c.title} — ${c.action}`}>{n}{!small && <> · {c.tag}</>}</span>;
}

function SystemGuide() {
  return (
    <div className="ss">
      <section className="card ss-intro">
        <div className="hb-kicker">TRAINING · HEADS OF DEPARTMENT & SUPERVISORS</div>
        <h2>7-Step Management System</h2>
        <p>Every head of department and supervisor reviews each person in their team with the same 7 steps, places them in one of 5 categories and gives them a plan for tomorrow. That is how they control their team and demand results: <b>Result &gt; Analysis &gt; Action.</b></p>
        <div className="ss-flow">
          <span className="ss-pill effort">Effort · steps 1 & 3</span><span>+</span><span className="ss-pill results">Results · steps 2, 4 & 5</span><span>→</span><span className="ss-pill">Category · step 6</span><span>→</span><span className="ss-pill">Action plan · step 7</span>
        </div>
      </section>
      <section className="card">
        <h2>The 7 steps</h2>
        <ol className="ss-steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="ss-n">{s.n}</span>
              <div>
                <div className="ss-t">{s.title} {s.measures && <span className={`ss-pill sm ${s.measures}`}>{s.measures}</span>}</div>
                <p>{s.text}</p>
                <p className="muted small"><b>How:</b> {HOW[s.n].how}</p>
                <p className="muted small"><b>In the system:</b> {HOW[s.n].inApp}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="card">
        <h2>The 5 employee categories</h2>
        <div className="ss-grid">
          <div className="ss-axis y">Results</div>
          <div className="ss-axis x">Effort</div>
          {CATEGORIES.map((c) => (
            <div key={c.n} className={`ss-cat cat-${c.n}`}>
              <div className="ss-cat-n">{c.n}</div>
              <div className="ss-cat-t">{c.title}</div>
              <div className="small">{c.tag}</div>
              <div className="ss-cat-a">{c.action}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Daily routine for a head of department</h2>
        <ol className="hb-list">
          <li>8:30 PM call time — give every person their task list and tonight’s targets (plan).</li>
          <li>During the shift — watch quality and productive hours; correct on the spot.</li>
          <li>End of shift — count tasks done and enter the facts.</li>
          <li>Open <b>New 7-step review</b> for each person: the time clock, tracker and sales fill in what the system knows.</li>
          <li>Choose the category and write tomorrow’s action plan; read it out at the next briefing.</li>
          <li>The Supervisor on Duty and the managers check <b>Team categories</b>: who was reviewed, who is Category 4–5 and needs a decision.</li>
        </ol>
        <div className="hb-note" style={{ marginTop: 12 }}><b>Example — Result &gt; Analysis &gt; Action.</b> Result: 18 orders vs plan 15, 2 LD’s vs plan 4, quality Good. Analysis: busy station but not offering ladies drinks. Action: offer an LD at every VIP table before 12 AM; head checks at 11 PM and 1 AM.</div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- reviews list
interface ReviewRow { id: string; employeeId: string; employeeName: string; department: string | null; position: string | null; photoUrl: string | null; date: string; reviewerName: string; category: number; suggestedCategory: number | null; resultsIndex: number | null; result: string; analysis: string; action: string }
type ReviewFull = ReviewRow & { input: ReviewInput; analysisData: Analysis };

function Reviews() {
  const [to, setTo] = useState(todayIso());
  const [from, setFrom] = useState(DateTime.fromISO(todayIso()).minus({ days: 6 }).toISODate()!);
  const [dept, setDept] = useState('');
  const [cat, setCat] = useState(0);
  const list = useApi<ReviewRow[]>(`/api/mgmt/reviews?from=${from}&to=${to}`);
  const [open, setOpen] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((r) => (!dept || r.department === dept) && (!cat || r.category === cat));
  const depts = [...new Set((list.data ?? []).map((r) => r.department ?? 'Unassigned'))].sort();
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center' }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center' }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        <div className="seg" role="group" aria-label="Category">
          <button className={!cat ? 'on' : ''} onClick={() => setCat(0)}>All</button>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} className={cat === n ? 'on' : ''} onClick={() => setCat(n)}>Cat. {n}</button>)}
        </div>
        <span className="muted small">{rows.length} reviews</span>
      </div>
      {list.error && <div className="error">{list.error}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Specialist</th><th>Department</th><th>Reviewed by</th><th>Category</th><th>Action plan for tomorrow</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                <td>{DateTime.fromISO(r.date).toFormat('ccc d LLL')}</td>
                <td><span className="row" style={{ gap: '.5rem', flexWrap: 'nowrap' }}><Avatar name={r.employeeName} photo={r.photoUrl} /><b>{r.employeeName}</b></span></td>
                <td className="muted">{r.department}</td>
                <td>{r.reviewerName}</td>
                <td><CategoryBadge n={r.category} />{r.suggestedCategory && r.suggestedCategory !== r.category && <div className="muted small">system suggested {r.suggestedCategory}</div>}</td>
                <td className="wrap-cell">{r.action}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No reviews in this period. Click “New 7-step review”.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <ReviewDetail id={open} onClose={() => setOpen(null)} onDeleted={async () => { setOpen(null); await list.reload(); }} />}
    </>
  );
}

function ReviewDetail({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: () => Promise<void> }) {
  const { me } = useAuth();
  const r = useApi<ReviewFull>(`/api/mgmt/reviews/${id}`);
  const [del, setDel] = useState(false);
  const d = r.data;
  return (
    <Modal title={d ? `${d.employeeName} · ${DateTime.fromISO(d.date).toFormat('cccc d LLL')}` : 'Review'} onClose={onClose} actions={<>
      {isAdmin(me?.role) && d && <button className="btn danger" onClick={() => setDel(true)}>Delete</button>}
      <span className="spacer" />
      {d && <Link className="btn" to={`/admin/management/review?employeeId=${d.employeeId}`}>Review again</Link>}
      <button className="btn" onClick={onClose}>Close</button>
    </>}>
      {!d ? <div className="muted">Loading…</div> : (
        <div className="rv-detail">
          <div className="row"><CategoryBadge n={d.category} /><span className="muted small">{CATEGORIES[d.category - 1].action} · reviewed by {d.reviewerName}</span></div>
          <dl className="kv">
            <dt>1 · Quantity</dt><dd>{d.input.tasksCompleted ?? '—'} of {d.input.tasksAssigned ?? '—'} tasks{d.analysisData.quantity ? ` · ${SCORE_LABEL[d.analysisData.quantity]}` : ''}</dd>
            <dt>2 · Quality</dt><dd>{d.input.qualityScore ? SCORE_LABEL[d.input.qualityScore] : '—'}{d.input.qualityNote ? ` — ${d.input.qualityNote}` : ''}</dd>
            <dt>3 · Hours</dt><dd>{d.input.productiveHours ?? '—'} h productive of {d.input.scheduledHours ?? '—'} h{d.analysisData.hoursRatio !== null ? ` (${d.analysisData.hoursRatio}%)` : ''}{d.input.hoursNote ? ` — ${d.input.hoursNote}` : ''}</dd>
            <dt>4 · Operational</dt><dd>{d.analysisData.operational.filter((m) => m.fact !== null).map((m) => `${m.name} ${m.fact}${m.unit ?? ''} / plan ${m.plan ?? '—'}${m.unit ?? ''}`).join(' · ') || '—'}</dd>
            <dt>5 · Financial</dt><dd>{d.input.revenueFact !== null ? `Revenue ${peso(d.input.revenueFact)}${d.input.revenuePlan !== null ? ` / plan ${peso(d.input.revenuePlan)}` : ''} · ` : ''}Cost {peso(d.input.cost ?? 0)}{d.analysisData.margin !== null ? ` · Margin ${peso(d.analysisData.margin)}` : ''}</dd>
          </dl>
          <div className="rv-raa">
            <div><b>Result</b><p>{d.result || '—'}</p></div>
            <div><b>Analysis</b><p>{d.analysis || '—'}</p></div>
            <div><b>Action</b><p>{d.action}</p></div>
          </div>
        </div>
      )}
      {del && <ConfirmDialog title="Delete this review?" message="It is removed from the team categories. The deletion is recorded in the audit log." confirmLabel="Delete" danger onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/api/mgmt/reviews/${id}`); await onDeleted(); }} />}
    </Modal>
  );
}

// ---------------------------------------------------------------- control
interface Overview {
  from: string; to: string; totals: number[]; reviewed: number; people: number; reviews: number;
  departments: { department: string; head: { key: string; title: string; holder: string | null; no: number | null } | null; team: number; reviewed: number; categories: number[]; reviewsInRange: number }[];
  alerts: { employeeId: string; name: string; department: string | null; category: number; date: string; action: string }[];
  reviewers: { name: string; reviews: number; people: number }[];
}
function Control() {
  const [to, setTo] = useState(todayIso());
  const from = DateTime.fromISO(to).minus({ days: 6 }).toISODate()!;
  const o = useApi<Overview>(`/api/mgmt/overview?from=${from}&to=${to}`);
  const nav = useNavigate();
  const d = o.data;
  const total = useMemo(() => d?.totals.reduce((a, b) => a + b, 0) ?? 0, [d]);
  if (o.error) return <div className="error">{o.error}</div>;
  if (!d) return <div className="muted">Loading…</div>;
  return (
    <div className="ctl">
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center' }}>Week ending<input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <span className="muted small">Categories use each person’s latest review in the 30 days to {DateTime.fromISO(to).toFormat('d LLL')}.</span>
      </div>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="tile"><div className="v">{d.reviewed}<span className="muted" style={{ fontSize: '1rem' }}> / {d.people}</span></div><div className="k">People reviewed this week ({d.reviews} reviews)</div></div>
        <div className="tile"><div className="v">{total ? Math.round(((d.totals[0] + d.totals[1]) / total) * 100) : 0}%</div><div className="k">Good results (Category 1–2)</div></div>
        <div className="tile"><div className="v">{d.totals[2]}</div><div className="k">Learning — invest in training (Category 3)</div></div>
        <div className="tile"><div className="v" style={{ color: d.alerts.length ? 'var(--critical)' : undefined }}>{d.alerts.length}</div><div className="k">Need a decision (Category 4–5)</div></div>
      </div>
      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><h2>Team by category</h2><span className="spacer" /><span className="muted small">{total} people with a recent review</span></div>
        <div className="cat-bar" role="img" aria-label={d.totals.map((n, i) => `Category ${i + 1}: ${n}`).join(', ')}>
          {d.totals.map((n, i) => n > 0 && <span key={i} className={`cat-${i + 1}`} style={{ flex: n }} title={`${CATEGORIES[i].title}: ${n}`}>{n}</span>)}
        </div>
        <div className="legend" style={{ marginTop: 8 }}>{CATEGORIES.map((c) => <span key={c.n}><i className={`cat-${c.n}`} />{c.n} · {c.tag} — {c.action}</span>)}</div>
      </section>
      <div className="ctl-2">
        <section className="card table-wrap">
          <h2>Departments</h2>
          <table>
            <thead><tr><th>Department</th><th>Head</th><th className="num">Reviewed this week</th><th>Categories 1 · 2 · 3 · 4 · 5</th></tr></thead>
            <tbody>
              {d.departments.map((x) => (
                <tr key={x.department}>
                  <td><b>{x.department}</b></td>
                  <td>{x.head ? <>{x.head.no ? `${x.head.no}. ` : ''}{x.head.holder ?? x.head.title}</> : <span className="muted">—</span>}</td>
                  <td className="num"><span className={x.reviewed === 0 ? 'bad-text' : x.reviewed < x.team ? '' : 'good-text'}>{x.reviewed} / {x.team}</span><div className="mini-bar"><i style={{ width: `${x.team ? (x.reviewed / x.team) * 100 : 0}%` }} /></div></td>
                  <td><span className="cat-dots">{x.categories.map((n, i) => <span key={i} className={n ? `cat-${i + 1}` : 'zero'}>{n}</span>)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="ctl-side">
          <section className="card">
            <h2>Need a decision</h2>
            {d.alerts.length === 0 ? <p className="muted small">No one in Category 4 or 5.</p> : d.alerts.map((a) => (
              <button key={a.employeeId} className="alert-row" onClick={() => nav(`/admin/management/review?employeeId=${a.employeeId}`)}>
                <CategoryBadge n={a.category} small />
                <span><b>{a.name}</b> <span className="muted small">· {a.department} · {DateTime.fromISO(a.date).toFormat('d LLL')}</span><span className="small">{a.action}</span></span>
              </button>
            ))}
          </section>
          <section className="card">
            <h2>Reviewers this week</h2>
            {d.reviewers.length === 0 ? <p className="muted small">No reviews yet this week.</p> : (
              <table><tbody>{d.reviewers.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.reviews} reviews · {r.people} people</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
