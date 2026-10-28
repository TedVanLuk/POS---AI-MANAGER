import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, daysAgoIso, fmtDateTime, fmtTime, hm, todayIso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { FighterCard, type CardData } from '../components/FighterCard';
import { ConfirmDialog, Modal, ReasonDialog } from '../components/Modal';
import { getDriver } from '../kiosk/drivers';
import { EmployeeForm, type EmployeeInput } from './EmployeeForm';
import type { DayRec } from './Attendance';

interface Employee extends EmployeeInput {
  id: string; hasPin: boolean; biometricConsentAt: string | null; loginEmail: string | null;
  fingerprints: { id: string; finger: string; format: string; quality: number | null; createdAt: string }[];
}
interface Note { id: string; category: string; title: string; body: string; rating: number; visibleToEmployee: boolean; authorName: string; createdAt: string }
interface Punch { id: string; type: 'in' | 'out'; punchedAt: string; method: string; matchScore: number | null; voided: boolean; reason: string | null; createdByName: string | null; deviceName: string | null }

const NOTE_BADGE: Record<string, string> = { commendation: 'good', coaching: 'info', warning: 'warn', incident: 'bad', general: '' };

export default function EmployeeDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const emp = useApi<Employee>(`/api/employees/${id}`);
  const card = useApi<CardData[]>(`/api/stats/cards?employeeId=${id}`);
  const [tab, setTab] = useState<'overview' | 'attendance' | 'notes' | 'biometrics' | 'edit'>('overview');
  const [pendingEdit, setPendingEdit] = useState<Record<string, unknown> | null>(null);
  const e = emp.data;
  if (emp.error) return <div className="error">{emp.error}</div>;
  if (!e) return <div className="muted">Loading…</div>;
  return (
    <>
      <div className="page-head">
        <h1>{e.firstName} {e.lastName}</h1>
        <span className="muted">{e.employeeNo} · {e.position ?? '—'}</span>
        {e.active === false && <span className="badge">Inactive</span>}
      </div>
      <div className="tabs">
        {(['overview', 'attendance', 'notes', 'biometrics', ...(isAdmin(me?.role) ? ['edit'] : [])] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t as typeof tab)}>{{ overview: 'Overview', attendance: 'Attendance', notes: 'Management notes', biometrics: 'Fingerprint & access', edit: 'Edit details' }[t]}</button>
        ))}
      </div>
      {tab === 'overview' && (
        <div className="row" style={{ alignItems: 'flex-start', gap: '1.5rem' }}>
          {card.data?.[0] && <FighterCard card={card.data[0]} />}
          <div className="card" style={{ flex: 1, minWidth: 280 }}>
            <h2>Last 30 days</h2>
            <RecordsTable employeeId={e.id} from={daysAgoIso(29)} to={todayIso()} compact />
          </div>
        </div>
      )}
      {tab === 'attendance' && <AttendanceTab employeeId={e.id} />}
      {tab === 'notes' && <NotesTab employeeId={e.id} />}
      {tab === 'biometrics' && <BiometricsTab e={e} reload={emp.reload} />}
      {tab === 'edit' && (
        <div className="card">
          <EmployeeForm initial={e} submitLabel="Save changes" onSubmit={async (f) => {
            const { id: _id, fingerprints: _f, hasPin: _h, biometricConsentAt: _b, loginEmail: _l, ...rest } = f as Employee;
            // A pay-rate change needs a reason for the audit log.
            if (f.rate !== e.rate) { setPendingEdit(rest as unknown as Record<string, unknown>); return; }
            await api.patch(`/api/employees/${e.id}`, rest);
            await emp.reload();
            setTab('overview');
          }} />
        </div>
      )}
      {pendingEdit && (
        <ReasonDialog title="Change pay rate" description={`New rate: ₱${Number(pendingEdit.rate).toLocaleString('en-PH')} (was ₱${e.rate.toLocaleString('en-PH')})`}
          onClose={() => setPendingEdit(null)} onConfirm={async (reason) => {
            await api.patch(`/api/employees/${e.id}`, { ...pendingEdit, reason });
            await emp.reload();
            setTab('overview');
          }} />
      )}
    </>
  );
}

export function RecordsTable({ employeeId, from, to, compact }: { employeeId: string; from: string; to: string; compact?: boolean }) {
  const data = useApi<{ days: DayRec[]; totals: Record<string, number> }[]>(`/api/attendance/records?employeeId=${employeeId}&from=${from}&to=${to}`);
  const r = data.data?.[0];
  if (!r) return <div className="muted">Loading…</div>;
  return (
    <>
      <div className="row small" style={{ marginBottom: '.5rem', gap: '1.25rem' }}>
        <span><b>{r.totals.daysPresent}</b> days present</span>
        <span><b>{r.totals.daysAbsent}</b> absent</span>
        <span><b>{r.totals.lateCount}</b> lates ({hm(r.totals.lateMinutes)})</span>
        <span><b>{hm(r.totals.overtimeMinutes)}</b> OT</span>
        <span><b>{hm(r.totals.nightDiffMinutes)}</b> night diff</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: compact ? 380 : undefined, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Date</th><th>Day</th><th>In</th><th>Out</th><th className="num">Worked</th><th className="num">Late</th><th className="num">UT</th><th className="num">OT</th><th className="num">ND</th></tr></thead>
          <tbody>
            {[...r.days].reverse().map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.absent ? <span className="badge bad">✕ Absent</span> : d.dayType === 'ordinary' ? (d.present ? '' : '—') : <span className="badge info">{d.dayType.replace(/_/g, ' ')}</span>}{d.missingOut && <span className="badge warn">! No time-out</span>}</td>
                <td>{fmtTime(d.firstIn)}</td>
                <td>{fmtTime(d.lastOut)}</td>
                <td className="num">{d.workedMinutes ? hm(d.workedMinutes) : '—'}</td>
                <td className="num">{d.lateMinutes ? <span className="badge warn">{d.lateMinutes}m</span> : '—'}</td>
                <td className="num">{d.undertimeMinutes ? `${d.undertimeMinutes}m` : '—'}</td>
                <td className="num">{d.overtimeMinutes ? hm(d.overtimeMinutes) : '—'}</td>
                <td className="num">{d.nightDiffMinutes + d.nightDiffOtMinutes ? hm(d.nightDiffMinutes + d.nightDiffOtMinutes) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AttendanceTab({ employeeId }: { employeeId: string }) {
  const [from, setFrom] = useState(daysAgoIso(13));
  const [to, setTo] = useState(todayIso());
  const punches = useApi<Punch[]>(`/api/attendance/punches?employeeId=${employeeId}&from=${from}&to=${to}`);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Punch | null>(null);
  const [type, setType] = useState<'in' | 'out'>('in');
  const [when, setWhen] = useState('');
  const [key, setKey] = useState(0);
  return (
    <div className="grid">
      <div className="row"><label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      <div className="card"><h2>Daily records</h2><RecordsTable key={key} employeeId={employeeId} from={from} to={to} /></div>
      <div className="card">
        <div className="row"><h2>Raw punches</h2><div className="spacer" /><button className="btn" onClick={() => setAdding(true)}>+ Manual punch</button></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Type</th><th>Method</th><th>Device / by</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {punches.data?.map((p) => (
              <tr key={p.id} className={p.voided ? 'disabled' : ''}>
                <td>{fmtDateTime(p.punchedAt)}</td>
                <td><span className={`badge ${p.type === 'in' ? 'good' : 'info'}`}>{p.type.toUpperCase()}</span></td>
                <td>{p.method}{p.matchScore ? <span className="muted small"> · score {p.matchScore}</span> : ''}</td>
                <td>{p.deviceName ?? p.createdByName ?? '—'}</td>
                <td className="small">{p.reason ?? ''}</td>
                <td>{!p.voided && <button className="btn sm danger" onClick={() => setVoiding(p)}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {adding && (
        <ReasonDialog title="Add manual punch" confirmLabel="Add punch" onClose={() => setAdding(false)} onConfirm={async (reason) => {
          await api.post('/api/attendance/punches', { employeeId, type, punchedAt: new Date(when).toISOString(), reason });
          await punches.reload(); setKey((k) => k + 1);
        }}>
          <div className="form-grid">
            <label className="field">Type<select value={type} onChange={(e) => setType(e.target.value as 'in' | 'out')}><option value="in">Time in</option><option value="out">Time out</option></select></label>
            <label className="field">Date & time<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          </div>
        </ReasonDialog>
      )}
      {voiding && (
        <ReasonDialog title="Void punch" description={`${voiding.type.toUpperCase()} at ${fmtDateTime(voiding.punchedAt)} will be excluded from attendance and payroll. It stays visible in the log.`} confirmLabel="Void" onClose={() => setVoiding(null)} onConfirm={async (reason) => {
          await api.post(`/api/attendance/punches/${voiding.id}/void`, { reason });
          await punches.reload(); setKey((k) => k + 1);
        }} />
      )}
    </div>
  );
}

function NotesTab({ employeeId }: { employeeId: string }) {
  const notes = useApi<Note[]>(`/api/notes?employeeId=${employeeId}`);
  const [f, setF] = useState({ category: 'general', title: '', body: '', rating: 0, visibleToEmployee: false });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid cols-2">
      <form className="card" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.post('/api/notes', { ...f, employeeId }); setF({ ...f, title: '', body: '', rating: 0 }); setError(null); await notes.reload(); } catch (err) { setError((err as Error).message); }
      }}>
        <h2>Add note</h2>
        <div className="form-grid">
          <label className="field">Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['commendation', 'coaching', 'warning', 'incident', 'general'].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field">Performance impact (−3…+3)<input type="number" min={-3} max={3} value={f.rating} onChange={(e) => setF({ ...f, rating: Number(e.target.value) })} /></label>
        </div>
        <label className="field" style={{ marginTop: '.5rem' }}>Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></label>
        <label className="field" style={{ marginTop: '.5rem' }}>Details<textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required /></label>
        <label className="row small" style={{ marginTop: '.5rem', gap: '.3rem' }}><input type="checkbox" checked={f.visibleToEmployee} onChange={(e) => setF({ ...f, visibleToEmployee: e.target.checked })} />Visible to the employee</label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" style={{ marginTop: '.75rem' }}>Save note</button>
      </form>
      <div className="grid" style={{ alignContent: 'start' }}>
        {notes.data?.length === 0 && <div className="muted">No notes yet.</div>}
        {notes.data?.map((n) => (
          <div key={n.id} className="card">
            <div className="row"><span className={`badge ${NOTE_BADGE[n.category]}`}>{n.category}</span><b>{n.title}</b><div className="spacer" /><span className="muted small">{n.rating > 0 ? `+${n.rating}` : n.rating} · {fmtDateTime(n.createdAt)}</span></div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
            <div className="muted small">by {n.authorName}{n.visibleToEmployee ? ' · visible to employee' : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BiometricsTab({ e, reload }: { e: Employee; reload: () => Promise<void> }) {
  const { me } = useAuth();
  const admin = isAdmin(me?.role);
  const [msg, setMsg] = useState<string | null>(null);
  const [finger, setFinger] = useState('R_INDEX');
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [login, setLogin] = useState({ email: e.loginEmail ?? '', password: '' });
  const driver = getDriver();

  const enroll = async () => {
    setBusy(true);
    setMsg(`Place ${finger.replace('_', ' ').toLowerCase()} finger on the reader (${driver.label})…`);
    try {
      let template: string, format: string, quality: number | undefined;
      if (driver.id === 'simulator') {
        template = `SIM:${e.employeeNo}`; format = 'SIMULATED'; quality = 90;
      } else {
        await driver.init();
        const a = await driver.capture({ timeoutMs: 15000 });
        setMsg('Lift and place the same finger again to confirm…');
        const b = await driver.capture({ timeoutMs: 15000 });
        const score = await driver.match(a.template, b.template);
        if (score < driver.threshold) throw new Error(`The two scans don't match (score ${score}). Clean the sensor and try again.`);
        ({ template, format, quality } = a);
      }
      await api.post(`/api/employees/${e.id}/fingerprints`, { finger, format, template, quality });
      setMsg('✓ Fingerprint enrolled');
      await reload();
    } catch (err) { setMsg(`✕ ${(err as Error).message}`); } finally { setBusy(false); }
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Fingerprint</h2>
        <p className="muted small">Fingerprints are sensitive personal information under the Data Privacy Act (RA 10173). Record written consent before enrolling. Templates are encrypted at rest; raw images are never stored.</p>
        <p>Consent: {e.biometricConsentAt ? <span className="badge good">✓ {fmtDateTime(e.biometricConsentAt)}</span> : <span className="badge warn">! Not recorded</span>}</p>
        {admin && !e.biometricConsentAt && <button className="btn" onClick={async () => { await api.post(`/api/employees/${e.id}/biometric-consent`); await reload(); }}>Record signed consent</button>}
        <table style={{ margin: '.75rem 0' }}>
          <tbody>{e.fingerprints.map((f) => <tr key={f.id}><td>{f.finger}</td><td>{f.format}</td><td>quality {f.quality ?? '—'}</td><td className="muted small">{fmtDateTime(f.createdAt)}</td></tr>)}</tbody>
        </table>
        {admin && e.biometricConsentAt && (
          <div className="row">
            <select value={finger} onChange={(ev) => setFinger(ev.target.value)}>
              {['R_INDEX', 'L_INDEX', 'R_THUMB', 'L_THUMB', 'R_MIDDLE', 'L_MIDDLE'].map((x) => <option key={x}>{x}</option>)}
            </select>
            <button className="btn primary" disabled={busy} onClick={enroll}>Enroll on this device</button>
            {e.fingerprints.length > 0 && <button className="btn danger" onClick={() => setDeleting(true)}>Delete all</button>}
          </div>
        )}
        <div className="muted small" style={{ marginTop: '.5rem' }}>Reader driver on this browser: <b>{driver.label}</b> (change it on the kiosk screen). Tip: enroll two fingers.</div>
        {msg && <div style={{ marginTop: '.5rem' }}>{msg}</div>}
      </div>
      <div className="card">
        <h2>Access</h2>
        <p>Kiosk PIN fallback: {e.hasPin ? <span className="badge good">✓ Set</span> : <span className="badge">Not set</span>}</p>
        {admin && <button className="btn" onClick={() => setPinOpen(true)}>{e.hasPin ? 'Reset PIN' : 'Set PIN'}</button>}
        <p style={{ marginTop: '1rem' }}>Employee portal login: {e.loginEmail ? <b>{e.loginEmail}</b> : <span className="badge">None</span>}</p>
        {admin && <button className="btn" onClick={() => setLoginOpen(true)}>{e.loginEmail ? 'Change login' : 'Create login'}</button>}
      </div>
      {deleting && <ConfirmDialog title="Delete fingerprints" danger confirmLabel="Delete all" message="All fingerprint templates for this employee will be deleted. They must be enrolled again to use the kiosk." onClose={() => setDeleting(false)} onConfirm={async () => { await api.del(`/api/employees/${e.id}/fingerprints`); await reload(); }} />}
      {pinOpen && (
        <Modal title="Set kiosk PIN" onClose={() => setPinOpen(false)} actions={<><button className="btn" onClick={() => setPinOpen(false)}>Cancel</button><button className="btn primary" onClick={async () => { await api.post(`/api/employees/${e.id}/pin`, { pin }); setPinOpen(false); await reload(); }}>Save</button></>}>
          <label className="field">4–6 digit PIN<input inputMode="numeric" value={pin} onChange={(ev) => setPin(ev.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        </Modal>
      )}
      {loginOpen && (
        <Modal title="Employee portal login" onClose={() => setLoginOpen(false)} actions={<><button className="btn" onClick={() => setLoginOpen(false)}>Cancel</button><button className="btn primary" onClick={async () => { try { await api.post(`/api/employees/${e.id}/login`, login); setLoginOpen(false); await reload(); } catch (err) { setLoginError((err as Error).message); } }}>Save</button></>}>
          <label className="field">Email<input type="email" value={login.email} onChange={(ev) => setLogin({ ...login, email: ev.target.value })} /></label>
          <label className="field" style={{ marginTop: '.5rem' }}>Password (min 8)<input type="password" value={login.password} onChange={(ev) => setLogin({ ...login, password: ev.target.value })} /></label>
          {loginError && <div className="error">{loginError}</div>}
        </Modal>
      )}
    </div>
  );
}
