import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, peso, todayIso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Modal } from '../components/Modal';

interface SheetItem { id: string; periodStart: string; periodEnd: string; label: string; status: 'draft' | 'final'; people: number; amount: number; paid: number; balance: number }

/** Weekly payroll sheets (the MDC paper format): one per week, Monday to Sunday. */
export default function PaySheets() {
  const { me } = useAuth();
  const nav = useNavigate();
  const list = useApi<SheetItem[]>('/api/pay-sheets');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekly payroll</h1>
          <div className="muted small">Days worked × daily rate + overtime (25%) + night differential (10%) − advances/penalties, per payroll sheet</div>
        </div>
        <div className="spacer" />
        {isAdmin(me?.role) && <button className="btn primary" onClick={() => setOpen(true)}>+ New weekly payroll</button>}
      </div>
      {list.error && <div className="error">{list.error}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Payroll period covered</th><th>Status</th><th className="num">People</th><th className="num">Total salary</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {list.data?.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/admin/payroll/sheets/${s.id}`)}>
                <td><b>{s.label}</b></td>
                <td>{s.status === 'final' ? <span className="badge good">Final</span> : <span className="badge">Draft</span>}</td>
                <td className="num">{s.people}</td>
                <td className="num"><b>{peso(s.amount)}</b></td>
                <td className="num">{peso(s.paid)}</td>
                <td className="num">{s.balance > 0 ? <span className="bad-text">{peso(s.balance)}</span> : peso(0)}</td>
              </tr>
            ))}
            {list.data?.length === 0 && <tr><td colSpan={6} className="muted">No weekly payroll yet. Click “New weekly payroll”.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <NewSheet onClose={() => setOpen(false)} onCreated={(id) => nav(`/admin/payroll/sheets/${id}`)} />}
    </>
  );
}

function NewSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const lastWeek = DateTime.fromISO(todayIso()).startOf('week').minus({ weeks: 1 });
  const [f, setF] = useState({ periodStart: lastWeek.toISODate()!, periodEnd: lastWeek.plus({ days: 6 }).toISODate()!, source: 'attendance' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setError(null);
    try { const r = await api.post<{ id: string }>('/api/pay-sheets', f); onCreated(r.id); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="New weekly payroll" onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create payroll'}</button>
    </>}>
      <div className="form-grid">
        <label className="field">From<input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value, periodEnd: DateTime.fromISO(e.target.value).plus({ days: 6 }).toISODate() ?? f.periodEnd })} /></label>
        <label className="field">To<input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></label>
      </div>
      <fieldset className="choice" style={{ marginTop: 12 }}>
        <legend className="small muted">Fill the days worked from</legend>
        {([['attendance', 'Time clock (fingerprint punches)', 'Days present, overtime from punches, and approved penalties as deductions.'],
          ['schedule', 'Weekly schedule', 'Planned duty days from Schedules. Use it when punches are incomplete.'],
          ['blank', 'Blank form', 'Start empty and type every row, like the paper sheet.']] as const).map(([k, t, d]) => (
          <label key={k} className="choice-row"><input type="radio" name="src" checked={f.source === k} onChange={() => setF({ ...f, source: k })} /><span><b>{t}</b><span className="muted small">{d}</span></span></label>
        ))}
      </fieldset>
      <p className="muted small" style={{ marginBottom: 0 }}>Everything stays editable until you mark the payroll final. Each change is saved with who made it and why.</p>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}
