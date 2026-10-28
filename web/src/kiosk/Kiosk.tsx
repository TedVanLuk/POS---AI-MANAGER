import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, fmtTime, session, setDisplayTimezone, todayIso } from '../api';
import { WeekStrip, type Week } from '../components/WeekStrip';
import { DRIVERS, getDriver, identify, setDriver, simulatorDriver, type BiometricDriver, type EnrolledTemplate } from './drivers';
import { enqueue, flushQueue, loadQueue } from './queue';
import './kiosk.css';

interface Info { tenantName: string; timezone: string; deviceName: string; driver: string }
interface PunchResponse { duplicate?: boolean; type?: 'in' | 'out'; punchedAt?: string; employee: { id: string; name: string; employeeNo: string; position: string | null }; week: Week }
type View =
  | { kind: 'idle' }
  | { kind: 'working'; text: string }
  | { kind: 'result'; data: PunchResponse; mode: 'punch' | 'week' }
  | { kind: 'offline'; name: string; at: string }
  | { kind: 'error'; text: string };

const uuid = () => crypto.randomUUID();
const RESULT_MS = 7000;

export default function Kiosk() {
  const [token, setToken] = useState(session.deviceToken());
  const [info, setInfo] = useState<Info | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<EnrolledTemplate[]>([]);
  const [driver, setDriverState] = useState<BiometricDriver | null>(null);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [weekMode, setWeekMode] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pending, setPending] = useState(loadQueue().length);
  const [now, setNow] = useState(new Date());
  const busy = useRef(false);
  const weekModeRef = useRef(weekMode);
  weekModeRef.current = weekMode;

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // Load device info + templates; refresh templates every 10 minutes.
  const loadAll = useCallback(async () => {
    try {
      const i = await api.device.get<Info>('/api/kiosk/info');
      setInfo(i);
      setDisplayTimezone(i.timezone);
      setTemplates(await api.device.get<EnrolledTemplate[]>('/api/kiosk/templates'));
      const d = getDriver(i.driver);
      try { await d.init(); setDriverState(d); setDriverError(null); } catch (e) { setDriverError((e as Error).message); setDriverState(null); }
      setSetupError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setSetupError('This tablet is not registered (or was revoked). Enter a device token.'); session.setDeviceToken(null); setToken(null); }
      else setSetupError(`Cannot reach server: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    if (!token) return;
    void loadAll();
    const t = setInterval(loadAll, 10 * 60_000);
    return () => clearInterval(t);
  }, [token, loadAll]);

  // Sync offline punches every 30s.
  useEffect(() => {
    if (!token) return;
    const sync = async () => setPending(await flushQueue((p) => api.device.post('/api/kiosk/punch', p)));
    const t = setInterval(sync, 30_000);
    void sync();
    return () => clearInterval(t);
  }, [token]);

  const showThenIdle = (v: View, ms = RESULT_MS) => {
    setView(v);
    setTimeout(() => { setView({ kind: 'idle' }); busy.current = false; }, ms);
  };

  const handleMatch = useCallback(async (employeeId: string, score: number, name: string) => {
    if (weekModeRef.current) {
      const data = await api.device.post<PunchResponse>('/api/kiosk/week', { employeeId });
      setWeekMode(false);
      return showThenIdle({ kind: 'result', data, mode: 'week' }, 10000);
    }
    const punch = { clientUuid: uuid(), employeeId, matchScore: score, punchedAt: new Date().toISOString() };
    try {
      const data = await api.device.post<PunchResponse>('/api/kiosk/punch', punch);
      showThenIdle({ kind: 'result', data, mode: 'punch' });
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) throw e;
      enqueue({ ...punch, name });
      setPending(loadQueue().length);
      showThenIdle({ kind: 'offline', name, at: punch.punchedAt });
    }
  }, []);

  // Capture loop.
  useEffect(() => {
    if (!driver || !templates.length) return;
    const ctrl = new AbortController();
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        if (busy.current) { await new Promise((r) => setTimeout(r, 300)); continue; }
        try {
          const probe = await driver.capture({ timeoutMs: driver.id === 'simulator' ? 0 : 10000, signal: ctrl.signal });
          busy.current = true;
          setView({ kind: 'working', text: 'Checking fingerprint…' });
          const hit = await identify(driver, probe, templates);
          if (!hit) { showThenIdle({ kind: 'error', text: 'Fingerprint not recognized — please try again' }, 2500); continue; }
          await handleMatch(hit.t.employeeId, hit.score, `${hit.t.firstName} ${hit.t.lastName}`);
        } catch (e) {
          if (stopped) return;
          const msg = (e as Error).message;
          if (msg === 'timeout' || msg.includes('Timed out')) continue;
          showThenIdle({ kind: 'error', text: msg }, 3000);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };
    void loop();
    return () => { stopped = true; ctrl.abort(); };
  }, [driver, templates, handleMatch]);

  if (!token) return <Setup onDone={(t) => { session.setDeviceToken(t); setToken(t); }} error={setupError} />;

  const timeStr = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: info?.timezone });
  const dateStr = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: info?.timezone });

  return (
    <div className="kiosk">
      <div className="k-top">
        <div>
          <div className="k-clock">{timeStr}</div>
          <div className="k-date">{dateStr}</div>
        </div>
        <div className="spacer" />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{info?.tenantName ?? '…'}</div>
          <div className="muted">{info?.deviceName} · {driver?.label ?? 'no reader'}</div>
          {pending > 0 && <div className="badge warn" style={{ marginTop: 4 }}>⟳ {pending} punch(es) waiting to sync</div>}
        </div>
      </div>

      <div className="k-center">
        {setupError && <div className="k-error">{setupError}</div>}
        {driverError && <div className="k-error">⚠ {driverError}</div>}
        {view.kind === 'idle' && (
          <div>
            <div className="k-prompt">{weekMode ? 'Scan your finger to see your week' : 'Place your finger on the scanner'}</div>
            <div className="k-finger" aria-hidden>☝</div>
            <div className="muted">{templates.length} enrolled fingerprints</div>
            {driver?.id === 'simulator' && <SimulatorPad templates={templates} />}
          </div>
        )}
        {view.kind === 'working' && <div className="k-prompt">{view.text}</div>}
        {view.kind === 'error' && <div className="k-error">✕ {view.text}</div>}
        {view.kind === 'offline' && (
          <div className="k-result">
            <div className="who">{view.name}</div>
            <div className="type">Saved ✓</div>
            <div className="muted">No connection — your punch at {fmtTime(view.at)} was saved on this tablet and will sync automatically.</div>
          </div>
        )}
        {view.kind === 'result' && <Result data={view.data} mode={view.mode} />}
      </div>

      <div className="k-bottom">
        <button className="btn" onClick={() => setWeekMode((w) => !w)}>{weekMode ? '✕ Cancel' : '📅 My week'}</button>
        <button className="btn" onClick={() => setPinOpen(true)}>🔢 Use PIN</button>
        <div className="spacer" />
        <select value={driver?.id ?? ''} onChange={(e) => { setDriver(e.target.value); void loadAll(); }} aria-label="Fingerprint reader driver">
          {DRIVERS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <Link className="btn" to="/login">Admin</Link>
      </div>

      {pinOpen && <PinDialog onClose={() => setPinOpen(false)} onResult={(data) => { setPinOpen(false); busy.current = true; showThenIdle({ kind: 'result', data, mode: 'punch' }); }} />}
    </div>
  );
}

function Result({ data, mode }: { data: PunchResponse; mode: 'punch' | 'week' }) {
  const late = data.week.days.find((d) => d.date === todayIso())?.lateMinutes ?? 0;
  return (
    <div className="k-result">
      <div className="row">
        <div>
          <div className="who">{data.employee.name}</div>
          <div className="muted">{data.employee.position} · {data.employee.employeeNo}</div>
        </div>
        <div className="spacer" />
        {mode === 'punch' && (
          <div style={{ textAlign: 'right' }}>
            <div className={`type ${data.type}`}>{data.type === 'in' ? 'TIME IN' : 'TIME OUT'}</div>
            <div style={{ fontSize: '1.3rem' }}>{fmtTime(data.punchedAt)}{data.duplicate ? ' (already recorded)' : ''}</div>
            {data.type === 'in' && late > 0 && <div className="badge warn" style={{ fontSize: '1rem' }}>⏱ Late {late} min</div>}
          </div>
        )}
      </div>
      <div style={{ marginTop: '1rem' }}><WeekStrip week={data.week} /></div>
    </div>
  );
}

function SimulatorPad({ templates }: { templates: EnrolledTemplate[] }) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => simulatorDriver.onWaiting(setWaiting), []);
  return (
    <div>
      <div className="muted small" style={{ marginTop: '1rem' }}>Simulator — tap a virtual finger:</div>
      <div className="sim">
        {templates.map((t) => (
          <button key={t.employeeId + t.finger} className="btn" disabled={!waiting} onClick={() => simulatorDriver.press(t.template)}>{t.firstName} {t.lastName[0]}.</button>
        ))}
        <button className="btn" disabled={!waiting} onClick={() => simulatorDriver.press('SIM:UNKNOWN')}>Unknown finger</button>
      </div>
    </div>
  );
}

function PinDialog({ onClose, onResult }: { onClose: () => void; onResult: (r: PunchResponse) => void }) {
  const [employeeNo, setEmployeeNo] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      onResult(await api.device.post<PunchResponse>('/api/kiosk/pin-punch', { clientUuid: uuid(), employeeNo: employeeNo.trim(), pin, punchedAt: new Date().toISOString() }));
    } catch (e) { setError((e as Error).message); setPin(''); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Punch with PIN</h2>
        <p className="muted small">Use only when your finger can't be read. PIN punches are logged for review.</p>
        <label className="field">Employee no.<input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="E-001" /></label>
        <label className="field" style={{ marginTop: '.5rem' }}>PIN<input value={'•'.repeat(pin.length)} readOnly /></label>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
            <button key={k} className={`btn ${k === 'OK' ? 'primary' : ''}`} onClick={() => k === '⌫' ? setPin(pin.slice(0, -1)) : k === 'OK' ? submit() : pin.length < 6 && setPin(pin + k)}>{k}</button>
          ))}
        </div>
        {error && <div className="error" style={{ marginTop: '.5rem' }}>{error}</div>}
        <div className="actions"><button className="btn" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

function Setup({ onDone, error }: { onDone: (t: string) => void; error: string | null }) {
  const [t, setT] = useState('');
  return (
    <div className="kiosk">
      <div className="k-center">
        <div className="k-result" style={{ maxWidth: 520 }}>
          <h1>Set up this time-clock tablet</h1>
          <p className="muted">In the admin panel go to <b>Settings → Kiosk devices</b>, register this tablet and paste the one-time device token here.</p>
          {error && <p className="k-error" style={{ fontSize: '1rem' }}>{error}</p>}
          <input style={{ width: '100%', padding: '.8rem' }} value={t} onChange={(e) => setT(e.target.value)} placeholder="Device token" />
          <div className="row" style={{ marginTop: '1rem' }}>
            <button className="btn primary" disabled={t.trim().length < 20} onClick={() => onDone(t.trim())}>Connect</button>
            <Link className="btn" to="/login">Admin login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
