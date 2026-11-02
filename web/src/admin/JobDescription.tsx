import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, DEMO } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { GROUNDS } from '../../../server/src/policy/handbook';
import type { JobDoc, ResolvedRole } from '../../../server/src/policy/jobs';
import { RoleEditor, type RolesRes } from './CompanyPolicy';

/** One job description, laid out as a document employees sign. */
export default function JobDescription() {
  const { key = '' } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const job = useApi<{ role: ResolvedRole; doc: JobDoc }>(`/api/policy/jobs/${encodeURIComponent(key)}`);
  const roles = useApi<RolesRes>('/api/policy/roles');
  const [editText, setEditText] = useState(false);
  const [editRole, setEditRole] = useState(false);
  if (job.error) return <div className="error">{job.error}</div>;
  if (!job.data) return <div className="muted">Loading…</div>;
  const { doc, role } = job.data;
  const admin = isAdmin(me?.role);
  const list = roles.data?.roles ?? [];
  const idx = list.findIndex((r) => r.key === key);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const open = (k: string) => nav(`/admin/policy/jobs/${encodeURIComponent(k)}`);
  const reload = async () => { await Promise.all([job.reload(), roles.reload()]); };

  return (
    <div className="jd-page">
      <div className="page-head no-print">
        <Link to="/admin/policy?tab=jobs" className="round-nav" aria-label="Back to job descriptions"><Icon name="left" /></Link>
        <h1 style={{ fontSize: '1.3rem' }}>Job description</h1>
        <div className="spacer" />
        {prev && <button className="btn sm" onClick={() => open(prev.key)}>← {prev.title}</button>}
        {next && <button className="btn sm" onClick={() => open(next.key)}>{next.title} →</button>}
        {admin && <button className="btn" onClick={() => setEditRole(true)}>Title & reporting</button>}
        {admin && <button className="btn primary" onClick={() => setEditText(true)}>Edit text</button>}
        {!DEMO && <button className="btn" onClick={() => window.print()}>Print</button>}
      </div>

      <article className="card jd-doc">
        <header className="jd-head">
          <div>
            <div className="hb-kicker">{doc.company.toUpperCase()} · JOB DESCRIPTION</div>
            <h2>{doc.title}</h2>
            <div className="muted">{doc.department ?? 'Management'}{doc.group ? ` · ${doc.group}` : ''}</div>
          </div>
          <span className={`lvl big ${doc.level}`}>{doc.level === 'management' ? 'Management' : doc.level === 'head' ? 'Head of department' : 'Staff'}</span>
        </header>

        <dl className="kv jd-meta">
          <dt>Reports to</dt><dd>{doc.reportsTo ? <button className="link-btn" onClick={() => open(doc.reportsTo!.key)}>{doc.reportsTo.title}</button> : 'Board / owners'}</dd>
          {role.level !== 'staff' && <><dt>Held by</dt><dd>{role.holder ?? <span className="bad-text">Vacant</span>}</dd></>}
          {doc.headcount !== null && <><dt>People in this job</dt><dd>{doc.headcount}</dd></>}
          {doc.supervises.length > 0 && <><dt>Supervises</dt><dd>{doc.supervises.map((s, i) => <span key={s.key}>{i > 0 && ', '}<button className="link-btn" onClick={() => open(s.key)}>{s.title}</button>{s.people !== null ? ` (${s.people})` : ''}</span>)}</dd></>}
          {role.edited && <><dt>Version</dt><dd className="muted">Edited by the company</dd></>}
        </dl>

        <Sec title="Job summary"><p>{doc.summary || <span className="muted">No summary yet.</span>}</p></Sec>
        <Sec title="Key responsibilities"><ol>{doc.duties.map((d, i) => <li key={i}>{d}</li>)}</ol></Sec>
        <div className="jd-2">
          <Sec title="Work schedule"><ul>{doc.schedule.map((d, i) => <li key={i}>{d}</li>)}</ul></Sec>
          <Sec title="Pay"><ul>{doc.pay.map((d, i) => <li key={i}>{d}</li>)}</ul></Sec>
        </div>
        <div className="jd-2">
          <Sec title="Performance measures (KPIs)"><ul>{doc.kpis.map((d, i) => <li key={i}>{d}</li>)}</ul></Sec>
          <Sec title="Qualifications & requirements"><ul>{doc.requirements.map((d, i) => <li key={i}>{d}</li>)}</ul></Sec>
        </div>
        {doc.commissions.length > 0 && <Sec title="Commissions & privileges (handbook)"><ul className="cols">{doc.commissions.map((d, i) => <li key={i}>{d}</li>)}</ul></Sec>}
        <Sec title="Code of conduct">
          <p className="muted small">All {GROUNDS.length} grounds for disciplinary action in the handbook apply. Most relevant for this job:</p>
          <ul>{doc.conduct.map((c) => <li key={c.n}><b>#{c.n}</b> {c.text}</li>)}</ul>
        </Sec>
        <div className="jd-2">
          <Sec title="Evaluation"><p>{doc.evaluation}</p></Sec>
          <Sec title="Disciplinary process"><ol>{doc.discipline.map((d, i) => <li key={i}>{d}</li>)}</ol></Sec>
        </div>
        <section className="jd-sign">
          <p className="small">I have read and understood this job description and the Mega Dance Center Employee Handbook.</p>
          <div className="jd-sign-grid">
            {['Employee name & signature', `Department head${doc.reportsTo ? ` (${doc.reportsTo.title})` : ''}`, 'General Admin', 'Date'].map((l) => <div key={l}><div className="line" /><span className="muted small">{l}</span></div>)}
          </div>
        </section>
      </article>

      {editText && <TextEditor role={role} onClose={() => setEditText(false)} onSaved={async () => { setEditText(false); await reload(); }} />}
      {editRole && roles.data && <RoleEditor role={role} roles={roles.data} onClose={() => setEditRole(false)} onSaved={async () => { setEditRole(false); await reload(); }} />}
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="jd-sec"><h3>{title}</h3>{children}</section>;
}

function TextEditor({ role, onClose, onSaved }: { role: ResolvedRole; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ summary: role.summary, duties: role.duties.join('\n'), kpis: role.kpis.join('\n'), skills: role.skills.join('\n'), focusRules: role.focusRules });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/api/policy/roles/${encodeURIComponent(role.key)}`, { summary: f.summary.trim(), duties: lines(f.duties), kpis: lines(f.kpis), skills: lines(f.skills), focusRules: f.focusRules, reason: reason.trim() || null });
      await onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit · ${role.title}`} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="review-form">
        <label className="field">Job summary<textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
        <label className="field">Key responsibilities (one per line)<textarea rows={7} value={f.duties} onChange={(e) => setF({ ...f, duties: e.target.value })} /></label>
        <label className="field">KPIs (one per line)<textarea value={f.kpis} onChange={(e) => setF({ ...f, kpis: e.target.value })} /></label>
        <label className="field">Qualifications & skills (one per line)<textarea value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} /></label>
        <h3>Most relevant conduct rules</h3>
        <div className="rule-pick">
          {GROUNDS.map((g, i) => (
            <label key={i} className="row small" style={{ gap: '.4rem', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <input type="checkbox" checked={f.focusRules.includes(i + 1)} onChange={(e) => setF({ ...f, focusRules: e.target.checked ? [...f.focusRules, i + 1].sort((a, b) => a - b) : f.focusRules.filter((n) => n !== i + 1) })} />
              <span><b>#{i + 1}</b> {g}</span>
            </label>
          ))}
        </div>
        <label className="field" style={{ marginTop: 8 }}>Reason (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {error && <div className="error">{error}</div>}
      </div>
    </Modal>
  );
}
