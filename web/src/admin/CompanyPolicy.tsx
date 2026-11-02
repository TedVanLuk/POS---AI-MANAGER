import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import floorPlan from '../assets/mdc-floor-plan.jpg?inline';
import type { Block, HandbookSection } from '../../../server/src/policy/handbook';
import type { ResolvedRole } from '../../../server/src/policy/jobs';

interface HandbookRes { company: string; handbook: { title: string; company: string; sections: HandbookSection[] } }
export interface RolesRes { company: string; roles: ResolvedRole[]; headcount: Record<string, number>; departments: string[] }
const TABS = [['handbook', 'Employee handbook'], ['hierarchy', 'Hierarchy'], ['jobs', 'Job descriptions']] as const;
type Tab = typeof TABS[number][0];

/** Company Policy: the employee handbook, the company hierarchy and a job description for every role. */
export default function CompanyPolicy() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'handbook';
  return (
    <>
      <div className="page-head">
        <div><h1>Company Policy</h1><div className="muted small">Mega Dance Center handbook, organization and job descriptions</div></div>
      </div>
      <div className="tabs" role="tablist" aria-label="Company policy">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams(k === 'handbook' ? {} : { tab: k }, { replace: true })}>{l}</button>)}
      </div>
      {tab === 'handbook' && <Handbook />}
      {tab === 'hierarchy' && <Hierarchy />}
      {tab === 'jobs' && <JobList />}
    </>
  );
}

// ---------------------------------------------------------------- handbook
function Handbook() {
  const hb = useApi<HandbookRes>('/api/policy/handbook');
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const all = hb.data?.handbook.sections ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) => `${s.title} ${JSON.stringify(s.blocks)}`.toLowerCase().includes(needle));
  }, [hb.data, q]);
  if (hb.error) return <div className="error">{hb.error}</div>;
  if (!hb.data) return <div className="muted">Loading…</div>;
  const parts = [...new Set(hb.data.handbook.sections.map((s) => s.part))];
  const go = (id: string) => document.getElementById(`hb-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="hb">
      <aside className="card hb-toc" aria-label="Table of contents">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the handbook…" aria-label="Search the handbook" />
        {parts.map((p) => (
          <div key={p}>
            <div className="hb-part">{p}</div>
            {hb.data!.handbook.sections.filter((s) => s.part === p).map((s) => (
              <button key={s.id} className={`hb-link ${sections.includes(s) ? '' : 'dim'}`} onClick={() => go(s.id)}>{s.title}</button>
            ))}
          </div>
        ))}
      </aside>
      <article className="hb-body">
        <section className="card hb-cover">
          <div className="hb-kicker">{hb.data.company.toUpperCase()}</div>
          <h2>{hb.data.handbook.title}</h2>
          <p className="muted">Here is the Party · Read it thoroughly. If you have questions about anything, contact your Manager on Duty.</p>
        </section>
        {sections.length === 0 && <div className="card muted">Nothing matches “{q}”.</div>}
        {sections.map((s) => (
          <section key={s.id} id={`hb-${s.id}`} className="card hb-sec">
            <div className="hb-part">{s.part}</div>
            <h2>{s.title}</h2>
            {s.blocks.map((b, i) => <HbBlock key={i} b={b} />)}
          </section>
        ))}
      </article>
    </div>
  );
}

function HbBlock({ b }: { b: Block }) {
  if ('p' in b) return <p>{b.p}</p>;
  if ('note' in b) return <div className="hb-note">{b.note}</div>;
  if ('list' in b) return b.ordered ? <ol className="hb-list">{b.list.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul className="hb-list">{b.list.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  if ('table' in b) return (
    <div className="table-wrap"><table className="hb-table">
      <thead><tr>{b.table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>{b.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
  if ('floorPlan' in b) return <figure className="hb-plan"><img src={floorPlan} alt="Mega Dance Center floor plan: DJ booth, VIP 1–14, cocktail tables, stage, Ultra VIP, Grey King 1 and 2, King 6–10, bar, reception and entrance" loading="lazy" /><figcaption className="muted small">Floor plan · consumables per table below</figcaption></figure>;
  if ('orgChart' in b) return (
    <div className="hb-org">
      {[['Mr. Simon Donovan', 'CEO'], ['Mr. Tsvetan Lukarski', 'COO']].map(([n, t]) => <div key={t} className="org-card mgmt"><b>{n}</b><span>{t}</span></div>)}
      <div className="hb-org-row">
        {[['Ms. Ma. Julien Castillo', 'Marketing & Entertainment Manager'], ['Mrs. Valentina Villaruel Mabatas', 'General Admin']].map(([n, t]) => <div key={t} className="org-card mgmt"><b>{n}</b><span>{t}</span></div>)}
      </div>
      <Link to="/admin/policy?tab=hierarchy" className="btn sm">See the full hierarchy with all departments</Link>
    </div>
  );
  if ('enforced' in b) return <div className="hb-enforced"><b>In the system</b><ul>{b.enforced.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return null;
}

// ---------------------------------------------------------------- hierarchy
function Hierarchy() {
  const { me } = useAuth();
  const roles = useApi<RolesRes>('/api/policy/roles');
  const [editing, setEditing] = useState<ResolvedRole | null>(null);
  const [adding, setAdding] = useState(false);
  const nav = useNavigate();
  if (roles.error) return <div className="error">{roles.error}</div>;
  if (!roles.data) return <div className="muted">Loading…</div>;
  const all = roles.data.roles;
  const kids = (key: string) => all.filter((r) => r.reportsTo === key);
  const roots = all.filter((r) => !r.reportsTo);
  const admin = isAdmin(me?.role);
  const vacant = all.filter((r) => !r.key.startsWith('staff:') && !r.holder).length;

  const Node = ({ r, depth }: { r: ResolvedRole; depth: number }) => {
    const children = kids(r.key);
    const people = r.key.startsWith('staff:') && r.department ? roles.data!.headcount[r.department] ?? 0 : null;
    return (
      <div className={`org-node d${Math.min(depth, 4)}`}>
        <div className={`org-card ${r.level}`}>
          <button className="org-main" onClick={() => nav(`/admin/policy/jobs/${encodeURIComponent(r.key)}`)} title="Open job description">
            <span className="org-title">{r.title}</span>
            {people !== null
              ? <span className="org-holder muted">{r.holder ? `${r.holder} · ` : ''}{people} {people === 1 ? 'person' : 'people'}{r.department ? ` · ${r.department}` : ''}</span>
              : <span className={`org-holder ${r.holder ? '' : 'vacant'}`}>{r.holder ?? 'Vacant — assign'}</span>}
          </button>
          {admin && <button className="org-edit" onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`} title="Edit"><Icon name="dots" /></button>}
        </div>
        {children.length > 0 && (
          <div className={depth < 2 ? 'org-row' : 'org-col'}>
            {children.map((c) => <Node key={c.key} r={c} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted small">The CEO, COO, Marketing & Entertainment Manager and General Admin are from the handbook. The Operations Manager and the department heads complete the structure — assign who holds each role.</span>
        <div className="spacer" />
        {vacant > 0 && <span className="badge warn">{vacant} roles to assign</span>}
        {admin && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> Add role</button>}
      </div>
      <div className="card org-wrap">
        {roots.map((r) => <Node key={r.key} r={r} depth={0} />)}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        <span><i style={{ background: 'var(--invert-bg)' }} />Management</span>
        <span><i style={{ background: 'var(--bronze)' }} />Head of department</span>
        <span><i style={{ background: 'var(--surface-3)' }} />Staff (people now)</span>
      </div>
      {editing && <RoleEditor role={editing} roles={roles.data} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await roles.reload(); }} />}
      {adding && <RoleEditor roles={roles.data} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await roles.reload(); }} />}
    </>
  );
}

/** Edit a role's title, holder and reporting line — or add a new role. */
export function RoleEditor({ role, roles, onClose, onSaved }: { role?: ResolvedRole; roles: RolesRes; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ title: role?.title ?? '', holder: role?.holder ?? '', reportsTo: role?.reportsTo ?? 'ops', department: role?.department ?? '', level: role?.level ?? 'head' });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const managers = roles.roles.filter((r) => r.level !== 'staff' && r.key !== role?.key);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = { title: f.title.trim(), holder: f.holder.trim() || null, reportsTo: role?.key === 'ceo' ? null : f.reportsTo, department: f.department || null, ...(role ? {} : { level: f.level }), reason: reason.trim() || null };
      if (role) await api.put(`/api/policy/roles/${encodeURIComponent(role.key)}`, body); else await api.post('/api/policy/roles', body);
      await onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!role) return;
    setBusy(true);
    try { await api.del(`/api/policy/roles/${encodeURIComponent(role.key)}`); await onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={role ? `Edit role · ${role.title}` : 'Add a role'} onClose={onClose} actions={<>
      {role?.edited && <button className="btn danger" disabled={busy} onClick={reset}>{role.custom ? 'Delete role' : 'Reset to default'}</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="form-grid">
        <label className="field">Role title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        {(role?.level ?? f.level) !== 'staff' && <label className="field">Held by<input value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} placeholder="Name, or leave empty if vacant" /></label>}
        {role?.key !== 'ceo' && <label className="field">Reports to<select value={f.reportsTo ?? ''} onChange={(e) => setF({ ...f, reportsTo: e.target.value })}>{managers.map((m) => <option key={m.key} value={m.key}>{m.title}{m.holder ? ` — ${m.holder}` : ''}</option>)}</select></label>}
        <label className="field">Department<select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">— None (management) —</option>{roles.departments.map((d) => <option key={d}>{d}</option>)}</select></label>
        {!role && <label className="field">Level<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as typeof f.level })}><option value="management">Management</option><option value="head">Head of department</option><option value="staff">Staff</option></select></label>}
        <label className="field" style={{ gridColumn: '1 / -1' }}>Reason (optional, saved in the audit log)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {!role && <p className="muted small">The new role gets an empty job description you can fill in on its page.</p>}
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- job descriptions
function JobList() {
  const roles = useApi<RolesRes>('/api/policy/roles');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  if (roles.error) return <div className="error">{roles.error}</div>;
  if (!roles.data) return <div className="muted">Loading…</div>;
  const all = roles.data.roles.filter((r) => `${r.title} ${r.department ?? ''} ${r.holder ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [
    { name: 'Management', roles: all.filter((r) => !r.department || r.level === 'management') },
    ...roles.data.departments.map((d) => ({ name: d, roles: all.filter((r) => r.department === d && r.level !== 'management') })),
  ].filter((g) => g.roles.length);
  const titleOf = (key: string | null) => roles.data!.roles.find((r) => r.key === key)?.title ?? '—';
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs, departments or names…" style={{ minWidth: 260 }} aria-label="Search job descriptions" />
        <span className="muted small">{roles.data.roles.length} job descriptions · generated from the handbook and each department’s settings; edit any of them</span>
      </div>
      <div className="jd-groups">
        {groups.map((g) => (
          <section key={g.name} className="card jd-group">
            <h3>{g.name}{roles.data!.headcount[g.name] ? <span className="muted small"> · {roles.data!.headcount[g.name]} people</span> : null}</h3>
            {g.roles.map((r) => (
              <button key={r.key} className="jd-item" onClick={() => nav(`/admin/policy/jobs/${encodeURIComponent(r.key)}`)}>
                <span className={`lvl ${r.level}`}>{r.level === 'management' ? 'Mgmt' : r.level === 'head' ? 'Head' : 'Staff'}</span>
                <span className="jd-t"><b>{r.title}</b><span className="muted small">Reports to {titleOf(r.reportsTo)}{r.holder && r.level !== 'staff' ? ` · ${r.holder}` : ''}</span></span>
                {r.edited && <span className="badge info">Edited</span>}
                <Icon name="right" />
              </button>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
