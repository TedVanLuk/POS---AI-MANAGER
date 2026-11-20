import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, fmtTime, peso, todayIso } from '../api';
import { useApi } from '../hooks';
import { Avatar, Icon } from '../components/Icon';
import { analyse, CATEGORIES, SCALE, SCORE_LABEL, scoreFromCompletion, STEPS, type Metric, type ReviewInput, type Score } from '../../../server/src/mgmt/sevenstep';
import { CategoryBadge } from './Management';

interface Prefill {
  employee: { id: string; name: string; department: string | null; position: string | null; photoUrl: string | null; dailyRate: number };
  attendance: { scheduled: boolean; present: boolean; firstIn: string | null; lastOut: string | null; lateMinutes: number; workedHours: number } | null;
  prefill: { scheduledHours: number; productiveHours: number | null; operational: Metric[]; revenuePlan: number | null; revenueFact: number | null; cost: number };
  reviewer: { key: string; title: string; holder: string | null } | null;
  reviewers: { key: string; title: string; holder: string | null }[];
  history: { id: string; date: string; category: number; resultsIndex: number | null; reviewerName: string; action: string }[];
}
interface Emp { id: string; firstName: string; lastName: string; department: string | null; active: boolean }
const n = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v)));
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** One 7-step review: steps 1–5 measured, step 6 category, step 7 tomorrow's action plan. */
export default function SevenStepReview() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const emps = useApi<Emp[]>('/api/employees');
  const [employeeId, setEmployeeId] = useState(params.get('employeeId') ?? '');
  const [date, setDate] = useState(params.get('date') ?? DateTime.fromISO(todayIso()).minus({ days: 1 }).toISODate()!);
  const pre = useApi<Prefill>(employeeId ? `/api/mgmt/prefill?employeeId=${employeeId}&date=${date}` : null);
  const p = pre.data;

  const [f, setF] = useState({ tasksAssigned: '', tasksCompleted: '', quantityScore: '' as Score | '', qualityScore: '' as Score | '', qualityNote: '', scheduledHours: '', productiveHours: '', hoursNote: '', revenuePlan: '', revenueFact: '', cost: '', effort: '' as '' | 'hard' | 'lazy', improving: '' as '' | 'yes' | 'no' });
  const [ops, setOps] = useState<Metric[]>([]);
  const [reviewer, setReviewer] = useState({ key: '', name: '' });
  const [category, setCategory] = useState<number | null>(null);
  const [raa, setRaa] = useState({ result: '', analysis: '', action: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load what the system knows whenever the person or the day changes.
  useEffect(() => {
    if (!p) return;
    setF((x) => ({ ...x, scheduledHours: s(p.prefill.scheduledHours), productiveHours: s(p.prefill.productiveHours), revenuePlan: s(p.prefill.revenuePlan), revenueFact: s(p.prefill.revenueFact), cost: s(p.prefill.cost) }));
    setOps(p.prefill.operational.map((m) => ({ ...m })));
    if (p.reviewer) setReviewer({ key: p.reviewer.key, name: p.reviewer.holder ?? p.reviewer.title });
    setCategory(null);
  }, [p]);

  const input: ReviewInput = useMemo(() => ({
    tasksAssigned: n(f.tasksAssigned), tasksCompleted: n(f.tasksCompleted), quantityScore: f.quantityScore || null, qualityScore: f.qualityScore || null, qualityNote: f.qualityNote || null,
    scheduledHours: n(f.scheduledHours), productiveHours: n(f.productiveHours), hoursNote: f.hoursNote || null, operational: ops,
    revenuePlan: n(f.revenuePlan), revenueFact: n(f.revenueFact), cost: n(f.cost), effort: f.effort || null, improving: f.improving === '' ? null : f.improving === 'yes',
  }), [f, ops]);
  const a = useMemo(() => analyse(input, p?.history ?? []), [input, p]);
  const chosen = category ?? a.suggestedCategory;
  const suggestedQty = scoreFromCompletion(input.tasksAssigned, input.tasksCompleted);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const setOp = (i: number, patch: Partial<Metric>) => setOps(ops.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/api/mgmt/reviews', { employeeId, date, reviewerRoleKey: reviewer.key || null, reviewerName: reviewer.name.trim(), input: { ...input, operational: ops.filter((m) => m.name.trim()) }, category: chosen ?? undefined, result: raa.result || a.reasons.join(' '), analysis: raa.analysis, action: raa.action });
      nav('/admin/management?tab=reviews');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ready = employeeId && reviewer.name.trim() && raa.action.trim().length >= 3 && chosen;
  const people = (emps.data ?? []).filter((e) => e.active).sort((x, y) => (x.department ?? '').localeCompare(y.department ?? '') || x.firstName.localeCompare(y.firstName));

  return (
    <div className="rv">
      <div className="page-head">
        <Link to="/admin/management?tab=reviews" className="round-nav" aria-label="Back to daily reviews"><Icon name="left" /></Link>
        <div><h1>7-step review</h1><div className="muted small">Result &gt; Analysis &gt; Action</div></div>
      </div>
      <section className="card rv-who">
        <label className="field">Specialist
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose a person…</option>
            {people.map((e) => <option key={e.id} value={e.id}>{`${e.firstName} ${e.lastName}`.trim()} · {e.department ?? '—'}</option>)}
          </select>
        </label>
        <label className="field">Night of<input type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        <label className="field">Reviewed by
          <select value={reviewer.key} onChange={(e) => { const r = p?.reviewers.find((x) => x.key === e.target.value); setReviewer({ key: e.target.value, name: r ? r.holder ?? r.title : reviewer.name }); }}>
            <option value="">Other…</option>
            {p?.reviewers.map((r) => <option key={r.key} value={r.key}>{r.holder ? `${r.holder} — ` : ''}{r.title}</option>)}
          </select>
        </label>
        {!reviewer.key && <label className="field">Reviewer name<input value={reviewer.name} onChange={(e) => setReviewer({ key: '', name: e.target.value })} /></label>}
      </section>

      {!employeeId ? <div className="card muted">Choose the person to review.</div> : !p ? <div className="muted">Loading…</div> : (
        <div className="rv-body">
          <div className="rv-steps">
            <section className="card rv-person">
              <Avatar name={p.employee.name} photo={p.employee.photoUrl} size="lg" />
              <div><b>{p.employee.name}</b><div className="muted small">{p.employee.position} · {p.employee.department} · {peso(p.employee.dailyRate)}/day</div>
                <div className="small">{p.attendance?.present ? `Clocked ${fmtTime(p.attendance.firstIn)} – ${p.attendance.lastOut ? fmtTime(p.attendance.lastOut) : 'no time-out'}${p.attendance.lateMinutes ? ` · ${p.attendance.lateMinutes} min late` : ''}` : p.attendance?.scheduled ? <span className="bad-text">Scheduled but no time-in on the clock</span> : 'Day off on the schedule'}</div>
              </div>
              {p.history[0] && <div className="rv-prev"><span className="muted small">Last review {DateTime.fromISO(p.history[0].date).toFormat('d LLL')} · by {p.history[0].reviewerName}</span><div className="row" style={{ gap: '.4rem', flexWrap: 'nowrap' }}><CategoryBadge n={p.history[0].category} small /><span className="small">Plan was: {p.history[0].action}</span></div></div>}
            </section>

            <Step n={1}>
              <div className="form-grid">
                <label className="field">Tasks assigned<input type="number" min={0} value={f.tasksAssigned} onChange={(e) => set('tasksAssigned', e.target.value)} /></label>
                <label className="field">Tasks completed<input type="number" min={0} value={f.tasksCompleted} onChange={(e) => set('tasksCompleted', e.target.value)} /></label>
              </div>
              <ScorePick value={f.quantityScore || suggestedQty || ''} suggested={!f.quantityScore && !!suggestedQty} onChange={(v) => set('quantityScore', v)} label="Quantity score" />
            </Step>
            <Step n={2}>
              <ScorePick value={f.qualityScore} onChange={(v) => set('qualityScore', v)} label="Quality score" />
              <label className="field">What was good or bad<input value={f.qualityNote} onChange={(e) => set('qualityNote', e.target.value)} placeholder="e.g. 2 wrong orders, slow to clear tables" /></label>
            </Step>
            <Step n={3}>
              <div className="form-grid">
                <label className="field">Scheduled hours<input type="number" min={0} max={24} step={0.5} value={f.scheduledHours} onChange={(e) => set('scheduledHours', e.target.value)} /></label>
                <label className="field">Productive hours<input type="number" min={0} max={24} step={0.5} value={f.productiveHours} onChange={(e) => set('productiveHours', e.target.value)} /></label>
              </div>
              <p className="muted small">Worked on the clock: {p.attendance?.workedHours ?? 0} h. Productive hours are what was actually worked — subtract long breaks and idle time.</p>
              <label className="field">Discrepancies<input value={f.hoursNote} onChange={(e) => set('hoursNote', e.target.value)} placeholder="e.g. 40 min away from station after 2 AM" /></label>
            </Step>
            <Step n={4}>
              <table className="rv-ops">
                <thead><tr><th>Metric</th><th className="num">Plan</th><th className="num">Fact</th><th className="num">Fact vs plan</th><th /></tr></thead>
                <tbody>
                  {ops.map((m, i) => {
                    const ach = a.operational[i]?.achievement;
                    return (
                      <tr key={i}>
                        <td><input value={m.name} onChange={(e) => setOp(i, { name: e.target.value })} aria-label="Metric" />{m.lowerIsBetter && <span className="muted small"> lower is better</span>}</td>
                        <td className="num"><input type="number" min={0} value={s(m.plan)} onChange={(e) => setOp(i, { plan: n(e.target.value) })} aria-label={`${m.name} plan`} /></td>
                        <td className="num"><input type="number" min={0} value={s(m.fact)} onChange={(e) => setOp(i, { fact: n(e.target.value) })} aria-label={`${m.name} fact`} /></td>
                        <td className="num">{ach === null || ach === undefined ? <span className="muted">—</span> : <b className={ach >= 100 ? 'good-text' : ach >= 90 ? '' : 'bad-text'}>{ach}%</b>}</td>
                        <td><button className="btn sm" onClick={() => setOps(ops.filter((_, j) => j !== i))} aria-label={`Remove ${m.name}`}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setOps([...ops, { name: '', plan: null, fact: null }])}>+ Add metric</button>
            </Step>
            <Step n={5}>
              <div className="form-grid">
                <label className="field">Revenue plan (₱)<input type="number" min={0} value={f.revenuePlan} onChange={(e) => set('revenuePlan', e.target.value)} /></label>
                <label className="field">Revenue fact (₱)<input type="number" min={0} value={f.revenueFact} onChange={(e) => set('revenueFact', e.target.value)} /></label>
                <label className="field">Cost to the company (₱)<input type="number" min={0} value={f.cost} onChange={(e) => set('cost', e.target.value)} /></label>
              </div>
              <p className="muted small">{a.revenueAchievement !== null ? `Revenue at ${a.revenueAchievement}% of plan. ` : ''}{a.margin !== null ? `Margin ${peso(a.margin)}.` : 'Revenue from order slips where the person sells; cost is the daily rate.'}</p>
            </Step>
            <Step n={6}>
              <div className="form-grid">
                <label className="field">Effort (steps 1 & 3)<select value={f.effort} onChange={(e) => set('effort', e.target.value)}><option value="">Auto — {a.suggestedEffort === 'hard' ? 'hard working' : a.suggestedEffort === 'lazy' ? 'lazy' : 'not enough data'}</option><option value="hard">Hard working</option><option value="lazy">Lazy</option></select></label>
                {!a.resultsGood && a.effort === 'hard' && <label className="field">Progress<select value={f.improving} onChange={(e) => set('improving', e.target.value)}><option value="">Auto — {a.suggestedImproving ? 'learning' : 'not improving'}</option><option value="yes">Learning / improving</option><option value="no">Cannot improve despite coaching</option></select></label>}
              </div>
              <div className="rv-cats" role="radiogroup" aria-label="Category">
                {CATEGORIES.map((c) => (
                  <button key={c.n} role="radio" aria-checked={chosen === c.n} className={`rv-cat cat-${c.n} ${chosen === c.n ? 'sel' : ''}`} onClick={() => setCategory(c.n)}>
                    <b>{c.n}</b><span>{c.title}</span><span className="small">{c.action}</span>
                    {a.suggestedCategory === c.n && <span className="rv-sug">Suggested</span>}
                  </button>
                ))}
              </div>
            </Step>
            <Step n={7}>
              <label className="field">Result<textarea value={raa.result} onChange={(e) => setRaa({ ...raa, result: e.target.value })} placeholder={a.reasons.join(' ') || 'What happened tonight, in numbers'} /></label>
              <label className="field">Analysis<textarea value={raa.analysis} onChange={(e) => setRaa({ ...raa, analysis: e.target.value })} placeholder="Why — what caused the result" /></label>
              <label className="field">Action for tomorrow (required)<textarea value={raa.action} onChange={(e) => setRaa({ ...raa, action: e.target.value })} placeholder="One specific, doable plan, e.g. Offer an LD at every VIP table before 12 AM; head checks at 11 PM and 1 AM." /></label>
            </Step>
          </div>

          <aside className="card rv-side" aria-live="polite">
            <h3>Analysis</h3>
            <dl className="kv">
              <dt>Completion</dt><dd>{a.completion !== null ? `${a.completion}%` : '—'}</dd>
              <dt>Quantity</dt><dd>{a.quantity ? SCORE_LABEL[a.quantity] : '—'}</dd>
              <dt>Quality</dt><dd>{input.qualityScore ? SCORE_LABEL[input.qualityScore] : '—'}</dd>
              <dt>Hours</dt><dd>{a.hoursRatio !== null ? `${a.hoursRatio}%${a.hoursGap ? ` (${a.hoursGap > 0 ? '+' : ''}${a.hoursGap} h)` : ''}` : '—'}</dd>
              <dt>Operational</dt><dd>{a.operationalAchievement !== null ? `${a.operationalAchievement}% of plan` : '—'}</dd>
              <dt>Revenue</dt><dd>{a.revenueAchievement !== null ? `${a.revenueAchievement}% of plan` : '—'}</dd>
            </dl>
            <div className="rv-verdict">
              <span className={`ss-pill ${a.resultsGood ? 'results' : 'bad'}`}>{a.resultsGood ? 'Good results' : 'Poor results'}</span>
              <span className={`ss-pill ${a.effort === 'hard' ? 'effort' : 'bad'}`}>{a.effort === 'hard' ? 'Hard working' : a.effort === 'lazy' ? 'Lazy' : 'Effort ?'}</span>
            </div>
            {chosen ? <div className="rv-chosen"><CategoryBadge n={chosen} /><p className="small">{CATEGORIES[chosen - 1].title}. <b>{CATEGORIES[chosen - 1].action}</b></p>{category && a.suggestedCategory && category !== a.suggestedCategory && <p className="muted small">You chose differently from the system’s suggestion ({a.suggestedCategory}) — explain why in the analysis.</p>}</div> : <p className="muted small">Score quality or enter plan vs fact to get a category.</p>}
            {error && <div className="error">{error}</div>}
            <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Save review'}</button>
            {!raa.action.trim() && <p className="muted small">Write tomorrow’s action plan (step 7) to save.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function Step({ n: num, children }: { n: number; children: React.ReactNode }) {
  const st = STEPS[num - 1];
  return (
    <section className="card rv-step">
      <div className="rv-step-h"><span className="ss-n">{num}</span><div><b>{st.title}</b><div className="muted small">{st.text}</div></div></div>
      {children}
    </section>
  );
}

function ScorePick({ value, onChange, label, suggested }: { value: Score | ''; onChange: (v: Score) => void; label: string; suggested?: boolean }) {
  return (
    <div className="seg score-pick" role="radiogroup" aria-label={label}>
      {SCALE.map((sc) => <button key={sc} role="radio" aria-checked={value === sc} className={`${value === sc ? 'on' : ''} sc-${sc}`} onClick={() => onChange(sc)}>{SCORE_LABEL[sc]}{value === sc && suggested ? ' (auto)' : ''}</button>)}
    </div>
  );
}
