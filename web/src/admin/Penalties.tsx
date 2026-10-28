import { useState } from 'react';
import { api, daysAgoIso, peso, todayIso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Modal, ReasonDialog } from '../components/Modal';

interface Penalty { id: string; employeeId: string; employeeName: string; employeeNo: string; date: string; kind: string; minutes: number | null; amount: number; reason: string; status: 'pending' | 'approved' | 'waived'; decidedByName: string | null; decisionReason: string | null; payrollRunId: string | null }
type RuleConfig =
  | { kind: 'late_tiered'; tiers: { minMinutes: number; maxMinutes: number | null; amount: number }[] }
  | { kind: 'late_frequency'; threshold: number; amount: number }
  | { kind: 'absence'; amount: number }
  | { kind: 'missing_timeout'; amount: number };
interface Rule { id: string; name: string; config: RuleConfig; active: boolean; autoApprove: boolean }

function describeRule(c: RuleConfig) {
  switch (c.kind) {
    case 'late_tiered': return c.tiers.map((t) => `${t.minMinutes}–${t.maxMinutes ?? '∞'} min late: ${peso(t.amount)}`).join(' · ');
    case 'late_frequency': return `${c.threshold}+ lates in a cutoff: ${peso(c.amount)}`;
    case 'absence': return `Each unexcused absence: ${peso(c.amount)}`;
    case 'missing_timeout': return `Each missing time-out: ${peso(c.amount)}`;
  }
}

export default function Penalties() {
  const { me } = useAuth();
  const [status, setStatus] = useState<'pending' | 'approved' | 'waived' | ''>('pending');
  const list = useApi<Penalty[]>(`/api/penalties${status ? `?status=${status}` : ''}`);
  const rules = useApi<Rule[]>('/api/penalty-rules');
  const employees = useApi<{ id: string; firstName: string; lastName: string }[]>('/api/employees');
  const [waiving, setWaiving] = useState<Penalty | null>(null);
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ employeeId: '', date: todayIso(), amount: '', kind: 'disciplinary' });
  const [ruleOpen, setRuleOpen] = useState(false);
  const [rule, setRule] = useState({ name: '', kind: 'late_frequency', amount: '100', threshold: '3', autoApprove: false });
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <div className="page-head">
        <h1>Penalties</h1>
        <div className="spacer" />
        <button className="btn" onClick={async () => { const r = await api.post<{ created: number }>('/api/penalties/generate', { from: daysAgoIso(30), to: todayIso() }); setMsg(`${r.created} new penalties generated from attendance`); await list.reload(); }}>Scan last 30 days</button>
        <button className="btn primary" onClick={() => setManual(true)}>+ Disciplinary deduction</button>
      </div>
      <div className="notice" style={{ marginBottom: '1rem' }}>
        ⚖️ Philippine Labor Code Art. 113 restricts deductions from wages. Penalty rules should be in a written company policy acknowledged by employees and reviewed by counsel.
        Auto-generated penalties wait here for a manager's decision; only <b>approved</b> penalties are deducted in payroll.
      </div>
      {msg && <div className="badge info" style={{ marginBottom: '.75rem' }}>{msg}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row"><h2>Rules</h2><div className="spacer" />{isAdmin(me?.role) && <button className="btn sm" onClick={() => setRuleOpen(true)}>+ Rule</button>}</div>
        <table><tbody>
          {rules.data?.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b></td>
              <td className="small" style={{ whiteSpace: 'normal' }}>{describeRule(r.config)}</td>
              <td>{r.autoApprove ? <span className="badge warn">Auto-approve</span> : <span className="badge">Needs approval</span>}</td>
              <td>{isAdmin(me?.role) ? <button className="btn sm" onClick={async () => { await api.patch(`/api/penalty-rules/${r.id}`, { active: !r.active }); await rules.reload(); }}>{r.active ? '● Active' : '○ Off'}</button> : r.active ? 'Active' : 'Off'}</td>
            </tr>
          ))}
        </tbody></table>
      </div>

      <div className="tabs">
        {(['pending', 'approved', 'waived', ''] as const).map((s) => <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s || 'All'}</button>)}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Employee</th><th>Reason</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.data?.map((p) => (
              <tr key={p.id}>
                <td>{p.date}</td>
                <td>{p.employeeName}</td>
                <td className="small" style={{ whiteSpace: 'normal' }}>{p.reason}{p.decisionReason && <div className="muted">Decision: {p.decisionReason} ({p.decidedByName})</div>}</td>
                <td className="num">{peso(p.amount)}</td>
                <td><span className={`badge ${p.status === 'approved' ? 'bad' : p.status === 'waived' ? '' : 'warn'}`}>{p.status}</span>{p.payrollRunId && <span className="badge info">in payroll</span>}</td>
                <td>
                  {p.status !== 'approved' && <button className="btn sm" onClick={async () => { await api.post(`/api/penalties/${p.id}/decide`, { decision: 'approved' }); await list.reload(); }}>Approve</button>}{' '}
                  {p.status !== 'waived' && <button className="btn sm" onClick={() => setWaiving(p)}>Waive</button>}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td colSpan={6} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>

      {waiving && <ReasonDialog title={`Waive penalty for ${waiving.employeeName}`} confirmLabel="Waive" onClose={() => setWaiving(null)} onConfirm={async (reason) => { await api.post(`/api/penalties/${waiving.id}/decide`, { decision: 'waived', reason }); await list.reload(); }} />}
      {manual && (
        <ReasonDialog title="Disciplinary deduction" confirmLabel="Create (pending approval)" onClose={() => setManual(false)} onConfirm={async (reason) => {
          await api.post('/api/penalties', { ...m, amount: Number(m.amount), reason });
          setStatus('pending'); await list.reload();
        }}>
          <div className="form-grid">
            <label className="field">Employee<select value={m.employeeId} onChange={(e) => setM({ ...m, employeeId: e.target.value })}><option value="">Select…</option>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label>
            <label className="field">Date<input type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} /></label>
            <label className="field">Amount (₱)<input type="number" min="0" value={m.amount} onChange={(e) => setM({ ...m, amount: e.target.value })} /></label>
            <label className="field">Type<select value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value })}><option value="disciplinary">Disciplinary</option><option value="damage">Damage / breakage</option><option value="shortage">Cash shortage</option><option value="uniform">Uniform / grooming</option></select></label>
          </div>
        </ReasonDialog>
      )}
      {ruleOpen && (
        <Modal title="New penalty rule" onClose={() => setRuleOpen(false)} actions={<>
          <button className="btn" onClick={() => setRuleOpen(false)}>Cancel</button>
          <button className="btn primary" onClick={async () => {
            const amount = Number(rule.amount);
            const config = rule.kind === 'late_frequency' ? { kind: 'late_frequency', threshold: Number(rule.threshold), amount } : rule.kind === 'late_tiered' ? { kind: 'late_tiered', tiers: [{ minMinutes: Number(rule.threshold), maxMinutes: null, amount }] } : { kind: rule.kind, amount };
            await api.post('/api/penalty-rules', { name: rule.name, config, autoApprove: rule.autoApprove });
            setRuleOpen(false); await rules.reload();
          }}>Create</button>
        </>}>
          <div className="form-grid">
            <label className="field">Name<input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></label>
            <label className="field">Type<select value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value })}><option value="late_frequency">Too many lates per cutoff</option><option value="late_tiered">Late more than N minutes</option><option value="absence">Absence (AWOL)</option><option value="missing_timeout">Missing time-out</option></select></label>
            {(rule.kind === 'late_frequency' || rule.kind === 'late_tiered') && <label className="field">{rule.kind === 'late_frequency' ? 'Number of lates' : 'Minutes late (from)'}<input type="number" value={rule.threshold} onChange={(e) => setRule({ ...rule, threshold: e.target.value })} /></label>}
            <label className="field">Amount (₱)<input type="number" value={rule.amount} onChange={(e) => setRule({ ...rule, amount: e.target.value })} /></label>
          </div>
          <label className="row small" style={{ gap: '.3rem', marginTop: '.5rem' }}><input type="checkbox" checked={rule.autoApprove} onChange={(e) => setRule({ ...rule, autoApprove: e.target.checked })} />Auto-approve (skip manager review)</label>
        </Modal>
      )}
    </>
  );
}
