import { useState } from 'react';
import { api, fmtDateTime } from '../api';
import { useApi } from '../hooks';
import { Modal } from '../components/Modal';

interface PayrollSettings {
  frequency: string; workDaysPerYear: number; hoursPerDay: number; statutorySchedule: string;
  components: Record<string, boolean>; nightDiffStart: string; nightDiffEnd: string; nightDiffRate: number; minOvertimeMinutes: number;
}
interface SettingsRes { name: string; timezone: string; settings: { payroll: PayrollSettings } }
interface Device { id: string; name: string; driver: string; active: boolean; lastSeenAt: string | null; createdAt: string }
interface Holiday { id: string; date: string; name: string; type: string }
interface Schedule { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; graceMinutes: number; restDays: number[] }
interface AuditRow { id: string; entity: string; action: string; actorName: string | null; reason: string | null; createdAt: string }

const COMPONENT_LABELS: Record<string, string> = {
  overtime: 'Overtime pay', nightDifferential: 'Night differential', holidayPay: 'Holiday pay', restDayPay: 'Rest-day premium',
  lateDeduction: 'Tardiness deduction', undertimeDeduction: 'Undertime deduction', absenceDeduction: 'Absence deduction (monthly-paid)',
  sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG', withholdingTax: 'Withholding tax', thirteenthMonthAccrual: '13th-month accrual',
  allowances: 'Allowances', penalties: 'Approved penalties',
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Settings() {
  const [tab, setTab] = useState<'payroll' | 'schedules' | 'holidays' | 'devices' | 'audit'>('payroll');
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <div className="tabs">
        {(['payroll', 'schedules', 'holidays', 'devices', 'audit'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ payroll: 'Payroll components', schedules: 'Work schedules', holidays: 'Holidays', devices: 'Kiosk devices', audit: 'Audit log' }[t]}</button>)}
      </div>
      {tab === 'payroll' && <PayrollSettingsTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'devices' && <DevicesTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}

function PayrollSettingsTab() {
  const s = useApi<SettingsRes>('/api/settings');
  const [msg, setMsg] = useState<string | null>(null);
  const p = s.data?.settings.payroll;
  if (!p) return <div className="muted">Loading…</div>;
  const save = async (patch: Partial<PayrollSettings>) => {
    await api.patch('/api/settings', { payroll: patch });
    await s.reload();
    setMsg('Saved — applies to runs computed from now on');
  };
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Components</h2>
        <p className="muted small">Switch off anything your company doesn't apply. Individual lines can also be switched off per payslip during review.</p>
        {Object.entries(COMPONENT_LABELS).map(([k, label]) => (
          <label key={k} className="row" style={{ padding: '.3rem 0' }}>
            <input type="checkbox" checked={p.components[k]} onChange={(e) => save({ components: { ...p.components, [k]: e.target.checked } })} />{label}
          </label>
        ))}
        {msg && <div className="badge good">{msg}</div>}
      </div>
      <div className="card">
        <h2>Rules</h2>
        <div className="form-grid">
          <label className="field">Pay frequency<select value={p.frequency} onChange={(e) => save({ frequency: e.target.value })}><option value="semi_monthly">Semi-monthly (15/30)</option><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></label>
          <label className="field">Work days / year (factor)<select value={p.workDaysPerYear} onChange={(e) => save({ workDaysPerYear: Number(e.target.value) })}><option value={261}>261 (5-day week)</option><option value={313}>313 (6-day week)</option><option value={365}>365</option></select></label>
          <label className="field">Statutory deductions<select value={p.statutorySchedule} onChange={(e) => save({ statutorySchedule: e.target.value })}><option value="split">Split across both cutoffs</option><option value="second_cutoff">All on 2nd cutoff</option></select></label>
          <label className="field">Min. overtime (minutes)<input type="number" defaultValue={p.minOvertimeMinutes} onBlur={(e) => save({ minOvertimeMinutes: Number(e.target.value) })} /></label>
          <label className="field">Night diff start<input type="time" defaultValue={p.nightDiffStart} onBlur={(e) => save({ nightDiffStart: e.target.value })} /></label>
          <label className="field">Night diff end<input type="time" defaultValue={p.nightDiffEnd} onBlur={(e) => save({ nightDiffEnd: e.target.value })} /></label>
        </div>
        <p className="muted small" style={{ marginTop: '.75rem' }}>Statutory tables: SSS 2025 (15%, MSC ₱5k–₱35k), PhilHealth 5% (₱10k–₱100k), Pag-IBIG 2% (max fund salary ₱10k), BIR TRAIN withholding (2023+). Premiums: OT 125%, rest/special 130%, regular holiday 200%, ND 10%.</p>
      </div>
    </div>
  );
}

function SchedulesTab() {
  const list = useApi<Schedule[]>('/api/schedules');
  const [f, setF] = useState({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] });
  return (
    <div className="grid cols-2">
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Hours</th><th>Break</th><th>Grace</th><th>Rest days</th></tr></thead>
          <tbody>{list.data?.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}</td><td>{s.breakMinutes}m</td><td>{s.graceMinutes}m</td><td>{s.restDays.map((d) => DAYS[d - 1]).join(', ')}</td></tr>)}</tbody>
        </table>
      </div>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); await api.post('/api/schedules', f); await list.reload(); }}>
        <h2>New schedule</h2>
        <div className="form-grid">
          <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="field">Start<input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></label>
          <label className="field">End<input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></label>
          <label className="field">Break (min)<input type="number" value={f.breakMinutes} onChange={(e) => setF({ ...f, breakMinutes: Number(e.target.value) })} /></label>
          <label className="field">Grace (min)<input type="number" value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: Number(e.target.value) })} /></label>
        </div>
        <div className="row" style={{ marginTop: '.5rem' }}>Rest days:
          {DAYS.map((d, i) => <label key={d} className="row small" style={{ gap: '.2rem' }}><input type="checkbox" checked={f.restDays.includes(i + 1)} onChange={(e) => setF({ ...f, restDays: e.target.checked ? [...f.restDays, i + 1] : f.restDays.filter((x) => x !== i + 1) })} />{d}</label>)}
        </div>
        <button className="btn primary" style={{ marginTop: '.75rem' }}>Add schedule</button>
      </form>
    </div>
  );
}

function HolidaysTab() {
  const year = new Date().getFullYear();
  const list = useApi<Holiday[]>(`/api/holidays?from=${year}-01-01&to=${year + 1}-12-31`);
  const [f, setF] = useState({ date: '', name: '', type: 'regular' });
  return (
    <div className="grid cols-2">
      <div className="card table-wrap">
        <table>
          <tbody>{list.data?.map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.name}</td><td><span className={`badge ${h.type === 'regular' ? 'info' : ''}`}>{h.type.replace(/_/g, ' ')}</span></td><td><button className="btn sm danger" onClick={async () => { await api.del(`/api/holidays/${h.id}`); await list.reload(); }}>✕</button></td></tr>)}</tbody>
        </table>
      </div>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); await api.post('/api/holidays', f); await list.reload(); }}>
        <h2>Add holiday</h2>
        <p className="muted small">Follow the yearly Presidential Proclamation; Eid'l Fitr / Eid'l Adha dates are announced separately.</p>
        <div className="form-grid">
          <label className="field">Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
          <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="field">Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="regular">Regular holiday</option><option value="special_non_working">Special non-working</option><option value="special_working">Special working</option></select></label>
        </div>
        <button className="btn primary" style={{ marginTop: '.75rem' }}>Save</button>
      </form>
    </div>
  );
}

function DevicesTab() {
  const list = useApi<Device[]>('/api/devices');
  const [f, setF] = useState({ name: '', driver: 'simulator' });
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="grid cols-2">
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Tablet</th><th>Reader</th><th>Last seen</th><th></th></tr></thead>
          <tbody>{list.data?.map((d) => <tr key={d.id} className={d.active ? '' : 'disabled'}><td>{d.name}</td><td>{d.driver}</td><td>{fmtDateTime(d.lastSeenAt)}</td><td>{d.active && <button className="btn sm danger" onClick={async () => { if (confirm('Revoke this tablet? It will stop working immediately.')) { await api.post(`/api/devices/${d.id}/revoke`); await list.reload(); } }}>Revoke</button>}</td></tr>)}</tbody>
        </table>
      </div>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); const r = await api.post<{ token: string }>('/api/devices', f); setToken(r.token); await list.reload(); }}>
        <h2>Register a kiosk tablet</h2>
        <div className="form-grid">
          <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Front counter tablet" required /></label>
          <label className="field">Reader<select value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}><option value="simulator">Simulator</option><option value="secugen-webapi">SecuGen (Windows WebAPI)</option><option value="android-bridge">Android native bridge</option></select></label>
        </div>
        <button className="btn primary" style={{ marginTop: '.75rem' }}>Register</button>
        <p className="muted small">Recommended hardware: SecuGen Hamster Pro 20 (Android or Windows) or ZKTeco ZK9500 on budget. See docs/03-hardware-fingerprint.md.</p>
      </form>
      {token && (
        <Modal title="Device token — copy it now" onClose={() => setToken(null)}>
          <p>Open <b>/kiosk</b> on the tablet and paste this token. It is shown only once.</p>
          <input readOnly value={token} style={{ width: '100%', fontFamily: 'monospace' }} onFocus={(e) => e.target.select()} />
        </Modal>
      )}
    </div>
  );
}

function AuditTab() {
  const list = useApi<AuditRow[]>('/api/audit?limit=200');
  return (
    <div className="card table-wrap">
      <table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>{list.data?.map((a) => <tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actorName ?? 'kiosk'}</td><td>{a.entity}</td><td><span className="badge">{a.action}</span></td><td className="small" style={{ whiteSpace: 'normal' }}>{a.reason ?? ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
