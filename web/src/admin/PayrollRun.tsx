import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDateTime, hm, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { ReasonDialog } from '../components/Modal';
import { STATUS_BADGE } from './PayrollRuns';

interface Line { id: string; code: string; label: string; category: 'earning' | 'deduction' | 'employer' | 'info'; quantity: number | null; rate: number | null; amount: number; taxable: boolean; enabled: boolean; isManual: boolean; editorName: string | null; editReason: string | null; updatedAt: string | null }
interface Slip { id: string; employeeId: string; gross: number; totalDeductions: number; net: number; summary: Record<string, number>; employee: { id: string; name: string; employeeNo: string; position: string | null }; lines: Line[] }
interface Run { id: string; periodStart: string; periodEnd: string; payDate: string | null; status: string; frequency: string; cutoff: number; computedAt: string | null; createdByName: string | null; approvedByName: string | null; approvedAt: string | null; totals: { gross: number; deductions: number; net: number; employer: number }; payslips: Slip[] }
interface Audit { id: string; action: string; actorName: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string }

const CAT_TITLE = { earning: 'Earnings', deduction: 'Deductions', employer: 'Employer contributions (not deducted)', info: 'Information' } as const;

export default function PayrollRun() {
  const { id } = useParams();
  const { me } = useAuth();
  const run = useApi<Run>(`/api/payroll/runs/${id}`);
  const audit = useApi<Audit[]>(`/api/payroll/runs/${id}/audit`);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'payslips' | 'history'>('payslips');
  const [action, setAction] = useState<null | 'reopen' | 'void'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = run.data;
  const reload = async () => { await run.reload(); await audit.reload(); };
  const editable = r && ['draft', 'review'].includes(r.status);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  if (run.error) return <div className="error">{run.error}</div>;
  if (!r) return <div className="muted">Loading…</div>;
  const slip = r.payslips.find((s) => s.id === selected) ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Payroll {r.periodStart} → {r.periodEnd}</h1>
        <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
        <div className="spacer" />
        {editable && <button className="btn" disabled={busy} onClick={() => act(() => api.post(`/api/payroll/runs/${r.id}/compute`))}>↻ Recompute from attendance</button>}
        {isAdmin(me?.role) && r.status === 'review' && <button className="btn primary" disabled={busy} onClick={() => confirm('Approve this payroll? It will be locked and payslips become visible to employees.') && act(() => api.post(`/api/payroll/runs/${r.id}/approve`))}>✓ Approve</button>}
        {isAdmin(me?.role) && r.status === 'approved' && <button className="btn primary" disabled={busy} onClick={() => act(() => api.post(`/api/payroll/runs/${r.id}/mark_paid`))}>Mark as paid</button>}
        {isAdmin(me?.role) && ['approved', 'review'].includes(r.status) && <button className="btn" onClick={() => setAction('reopen')}>Reopen</button>}
        {isAdmin(me?.role) && ['draft', 'review', 'approved'].includes(r.status) && <button className="btn danger" onClick={() => setAction('void')}>Void</button>}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      {error && <div className="error" style={{ marginBottom: '.75rem' }}>{error}</div>}
      <div className="grid cols-4">
        <div className="card stat"><div className="label">Employees</div><div className="value">{r.payslips.length}</div></div>
        <div className="card stat"><div className="label">Gross pay</div><div className="value">{peso(r.totals.gross)}</div></div>
        <div className="card stat"><div className="label">Deductions</div><div className="value">{peso(r.totals.deductions)}</div></div>
        <div className="card stat"><div className="label">Net pay</div><div className="value">{peso(r.totals.net)}</div></div>
        <div className="card stat"><div className="label">Employer contributions</div><div className="value">{peso(r.totals.employer)}</div></div>
      </div>
      <p className="muted small" style={{ marginTop: '.75rem' }}>
        Created by {r.createdByName ?? '—'} · computed {fmtDateTime(r.computedAt)}{r.approvedByName ? ` · approved by ${r.approvedByName} ${fmtDateTime(r.approvedAt)}` : ''}
        {!editable && ' · 🔒 locked — reopen to edit'}
      </p>
      <div className="tabs">
        <button className={tab === 'payslips' ? 'active' : ''} onClick={() => setTab('payslips')}>Payslips</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Edit history ({audit.data?.length ?? 0})</button>
      </div>

      {tab === 'payslips' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(360px, 1.3fr)', alignItems: 'start' }}>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Employee</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th></tr></thead>
              <tbody>
                {r.payslips.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setSelected(s.id)} style={s.id === selected ? { outline: '2px solid var(--accent)' } : undefined}>
                    <td><b>{s.employee.name}</b>{s.lines.some((l) => l.isManual || !l.enabled) && <span className="badge info" title="Has manual edits"> ✎</span>}<div className="muted small">{s.employee.position}</div></td>
                    <td className="num">{peso(s.gross)}</td>
                    <td className="num">{peso(s.totalDeductions)}</td>
                    <td className="num"><b>{peso(s.net)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {slip ? <PayslipEditor slip={slip} editable={!!editable} onChanged={reload} /> : <div className="card muted">Select an employee to review and edit their payslip.</div>}
        </div>
      )}

      {tab === 'history' && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Change</th><th>Reason</th></tr></thead>
            <tbody>
              {audit.data?.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.createdAt)}</td>
                  <td>{a.actorName ?? '—'}</td>
                  <td><span className="badge">{a.action}</span></td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{describe(a, r)}</td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{a.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {action && (
        <ReasonDialog title={action === 'reopen' ? 'Reopen payroll run' : 'Void payroll run'} confirmLabel={action === 'reopen' ? 'Reopen' : 'Void run'}
          description={action === 'reopen' ? 'The run goes back to draft so lines can be edited again.' : 'The run is cancelled permanently; its penalties become available for the next run.'}
          onClose={() => setAction(null)} onConfirm={async (reason) => { await api.post(`/api/payroll/runs/${r.id}/${action}`, { reason }); await reload(); }} />
      )}
    </>
  );
}

function describe(a: Audit, r: Run) {
  const emp = r.payslips.find((s) => s.employeeId === (a.after?.employeeId ?? a.before?.employeeId))?.employee.name;
  const b = a.before ?? {}, af = a.after ?? {};
  if (a.action === 'edit') {
    const parts = [];
    if ('amount' in af && af.amount !== undefined) parts.push(`amount ${peso(b.amount as number)} → ${peso(af.amount as number)}`);
    if ('enabled' in af && af.enabled !== undefined) parts.push(af.enabled ? 'switched ON' : 'switched OFF');
    if ('label' in af && af.label !== undefined) parts.push(`label → “${af.label}”`);
    return `${emp ?? ''} · ${b.label ?? b.code}: ${parts.join(', ')}`;
  }
  if (a.action === 'add_manual') return `${emp ?? ''} · added ${af.category} “${af.label}” ${peso(af.amount as number)}`;
  if (a.action === 'remove_manual') return `${emp ?? ''} · removed “${b.label}” ${peso(b.amount as number)}`;
  if (a.action === 'reset') return `${emp ?? ''} · ${b.code} restored to computed value`;
  if ('status' in af) return `${b.status} → ${af.status}`;
  if (a.action === 'compute') return `computed ${af.employees ?? ''} payslips`;
  return '';
}

function PayslipEditor({ slip, editable, onChanged }: { slip: Slip; editable: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<{ line: Line; mode: 'amount' | 'toggle' | 'reset' | 'remove' } | null>(null);
  const [amount, setAmount] = useState('');
  const [adding, setAdding] = useState(false);
  const [newLine, setNewLine] = useState({ label: '', category: 'deduction' as 'earning' | 'deduction', amount: '', taxable: false });
  const s = slip.summary;
  return (
    <div className="card">
      <div className="row">
        <div><h2 style={{ marginBottom: 0 }}>{slip.employee.name}</h2><div className="muted small">{slip.employee.employeeNo} · {slip.employee.position}</div></div>
        <div className="spacer" />
        <Link to={`/admin/employees/${slip.employee.id}`} className="small">Attendance →</Link>
      </div>
      <div className="row small muted" style={{ margin: '.6rem 0', gap: '1rem' }}>
        <span>Present {s.daysPresent ?? 0}d</span><span>Absent {s.daysAbsent ?? 0}d</span><span>Late {s.lateCount ?? 0}× ({s.lateMinutes ?? 0}m)</span>
        <span>UT {s.undertimeMinutes ?? 0}m</span><span>OT {hm(s.overtimeMinutes ?? 0)}</span><span>ND {hm(s.nightDiffMinutes ?? 0)}</span><span>Taxable {peso(s.taxableIncome)}</span>
      </div>
      {(['earning', 'deduction', 'employer', 'info'] as const).map((cat) => {
        const lines = slip.lines.filter((l) => l.category === cat);
        if (!lines.length) return null;
        return (
          <div key={cat} style={{ marginTop: '.75rem' }}>
            <h3>{CAT_TITLE[cat]}</h3>
            <table>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={l.enabled ? '' : 'disabled'}>
                    <td style={{ whiteSpace: 'normal' }}>
                      {l.label}
                      {l.quantity !== null && <span className="muted small"> · {l.quantity}{l.rate !== null ? ` × ${peso(l.rate)}` : ''}</span>}
                      {(l.isManual || !l.enabled) && l.editorName && <div className="small" style={{ color: 'var(--accent)' }}>✎ {l.editorName}: {l.editReason}</div>}
                    </td>
                    <td className="num">{peso(l.amount)}</td>
                    {editable && (
                      <td className="num" style={{ width: 1 }}>
                        <div className="row" style={{ gap: '.25rem', flexWrap: 'nowrap' }}>
                          {cat !== 'info' && <button className="btn sm" title="Change amount" onClick={() => { setAmount(String(l.amount)); setEditing({ line: l, mode: 'amount' }); }}>✎</button>}
                          {!l.code.startsWith('MANUAL_') && cat !== 'info' && <button className="btn sm" title={l.enabled ? 'Switch off this item' : 'Switch on'} onClick={() => setEditing({ line: l, mode: 'toggle' })}>{l.enabled ? 'Off' : 'On'}</button>}
                          {!l.code.startsWith('MANUAL_') && (l.isManual || !l.enabled) && <button className="btn sm" title="Restore computed value" onClick={() => setEditing({ line: l, mode: 'reset' })}>↺</button>}
                          {l.code.startsWith('MANUAL_') && <button className="btn sm danger" onClick={() => setEditing({ line: l, mode: 'remove' })}>✕</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <table style={{ marginTop: '.75rem' }}>
        <tbody>
          <tr><td>Gross pay</td><td className="num">{peso(slip.gross)}</td></tr>
          <tr><td>Total deductions</td><td className="num">− {peso(slip.totalDeductions)}</td></tr>
          <tr><td><b>Net pay</b></td><td className="num"><b style={{ fontSize: '1.15rem' }}>{peso(slip.net)}</b></td></tr>
        </tbody>
      </table>
      {editable && <button className="btn" style={{ marginTop: '.75rem' }} onClick={() => setAdding(true)}>+ Add manual item (bonus, cash advance, loan…)</button>}

      {editing && (
        <ReasonDialog
          title={editing.mode === 'amount' ? `Change “${editing.line.label}”` : editing.mode === 'toggle' ? `${editing.line.enabled ? 'Switch off' : 'Switch on'} “${editing.line.label}”` : editing.mode === 'reset' ? `Restore “${editing.line.label}”` : `Remove “${editing.line.label}”`}
          description={editing.mode === 'toggle' && editing.line.enabled ? 'The item stays on the payslip, crossed out, and is excluded from totals and tax.' : editing.mode === 'reset' ? 'The computed value will be used again.' : undefined}
          onClose={() => setEditing(null)}
          onConfirm={async (reason) => {
            const l = editing.line;
            if (editing.mode === 'amount') await api.patch(`/api/payroll/lines/${l.id}`, { amount: Number(amount), reason });
            if (editing.mode === 'toggle') await api.patch(`/api/payroll/lines/${l.id}`, { enabled: !l.enabled, reason });
            if (editing.mode === 'reset') await api.post(`/api/payroll/lines/${l.id}/reset`, { reason });
            if (editing.mode === 'remove') await api.del(`/api/payroll/lines/${l.id}`, { reason });
            await onChanged();
          }}>
          {editing.mode === 'amount' && <label className="field">New amount (₱) — was {peso(editing.line.amount)}<input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
        </ReasonDialog>
      )}
      {adding && (
        <ReasonDialog title="Add manual payslip item" confirmLabel="Add item" onClose={() => setAdding(false)} onConfirm={async (reason) => {
          await api.post(`/api/payroll/payslips/${slip.id}/lines`, { ...newLine, amount: Number(newLine.amount), reason });
          setNewLine({ label: '', category: 'deduction', amount: '', taxable: false });
          await onChanged();
        }}>
          <div className="form-grid">
            <label className="field">Type<select value={newLine.category} onChange={(e) => setNewLine({ ...newLine, category: e.target.value as 'earning' | 'deduction' })}><option value="earning">Earning</option><option value="deduction">Deduction</option></select></label>
            <label className="field">Label<input value={newLine.label} onChange={(e) => setNewLine({ ...newLine, label: e.target.value })} placeholder="Cash advance" /></label>
            <label className="field">Amount (₱)<input type="number" step="0.01" min="0" value={newLine.amount} onChange={(e) => setNewLine({ ...newLine, amount: e.target.value })} /></label>
          </div>
          <label className="row small" style={{ gap: '.3rem', marginTop: '.5rem' }}><input type="checkbox" checked={newLine.taxable} onChange={(e) => setNewLine({ ...newLine, taxable: e.target.checked })} />{newLine.category === 'earning' ? 'Taxable earning' : 'Reduces taxable income (pre-tax)'}</label>
        </ReasonDialog>
      )}
    </div>
  );
}
