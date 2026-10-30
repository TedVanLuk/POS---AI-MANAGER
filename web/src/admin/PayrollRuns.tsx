import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Modal } from '../components/Modal';
import Penalties from './Penalties';
import PaySheets from './PaySheets';

interface Run { id: string; periodStart: string; periodEnd: string; payDate: string | null; frequency: string; cutoff: number; status: string; employees: number; gross: number; net: number }
export const STATUS_BADGE: Record<string, string> = { draft: '', review: 'info', approved: 'good', paid: 'good', void: 'bad' };

/** Suggest the next semi-monthly cutoff (1–15, 16–end). */
function nextPeriod(runs: Run[]) {
  const last = runs[0];
  const base = last ? new Date(`${last.periodEnd}T00:00:00`) : new Date(Date.now() - 16 * 86400000);
  const d = new Date(base.getTime() + 86400000);
  const y = d.getFullYear(), m = d.getMonth();
  const fmt = (dt: Date) => dt.toLocaleDateString('en-CA');
  if (d.getDate() <= 15) return { periodStart: fmt(new Date(y, m, 1)), periodEnd: fmt(new Date(y, m, 15)) };
  return { periodStart: fmt(new Date(y, m, 16)), periodEnd: fmt(new Date(y, m + 1, 0)) };
}

const TABS = [['weekly', 'Weekly payroll'], ['runs', 'Statutory payroll (SSS · PhilHealth · Pag-IBIG · tax)'], ['penalties', 'Penalties']] as const;

/** Payroll section: cutoff runs, plus the penalties that feed their deductions. */
export default function PayrollRuns() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'weekly';
  const pending = useApi<unknown[]>('/api/penalties?status=pending');
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Payroll sections">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams(k === 'weekly' ? {} : { tab: k }, { replace: true })}>
            {label}{k === 'penalties' && pending.data?.length ? ` · ${pending.data.length} to review` : ''}
          </button>
        ))}
      </div>
      {tab === 'penalties' ? <Penalties embedded /> : tab === 'runs' ? <Runs /> : <PaySheets />}
    </>
  );
}

function Runs() {
  const { me } = useAuth();
  const nav = useNavigate();
  const runs = useApi<Run[]>('/api/payroll/runs');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ periodStart: '', periodEnd: '', payDate: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="page-head">
        <h1>Statutory payroll</h1>
        <div className="spacer" />
        {isAdmin(me?.role) && <button className="btn primary" onClick={() => { setF({ ...nextPeriod(runs.data ?? []), payDate: '' }); setOpen(true); }}>+ New payroll run</button>}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Period</th><th>Cutoff</th><th>Pay date</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net</th></tr></thead>
          <tbody>
            {runs.data?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/admin/payroll/${r.id}`)}>
                <td><b>{r.periodStart} → {r.periodEnd}</b></td>
                <td>{r.frequency.replace('_', '-')} #{r.cutoff}</td>
                <td>{r.payDate ?? '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                <td className="num">{r.employees}</td>
                <td className="num">{peso(r.gross)}</td>
                <td className="num">{peso(r.net)}</td>
              </tr>
            ))}
            {runs.data?.length === 0 && <tr><td colSpan={7} className="muted">No payroll runs yet — create one for the current cutoff.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title="New payroll run" onClose={() => setOpen(false)} actions={<>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" onClick={async () => {
            try {
              const run = await api.post<{ id: string }>('/api/payroll/runs', { ...f, payDate: f.payDate || null });
              await api.post(`/api/payroll/runs/${run.id}/compute`);
              nav(`/admin/payroll/${run.id}`);
            } catch (e) { setError((e as Error).message); }
          }}>Create & compute</button>
        </>}>
          <div className="form-grid">
            <label className="field">Period start<input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></label>
            <label className="field">Period end<input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></label>
            <label className="field">Pay date<input type="date" value={f.payDate} onChange={(e) => setF({ ...f, payDate: e.target.value })} /></label>
          </div>
          <p className="muted small">Payslips are generated from time-in/time-out records. Approved penalties in the period are deducted. You can review and edit every line before approval.</p>
          {error && <div className="error">{error}</div>}
        </Modal>
      )}
    </>
  );
}
