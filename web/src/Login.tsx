import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEMO } from './api';
import { isStaff, useAuth } from './auth';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(email, password);
      nav(isStaff(me.role) ? '/admin' : '/me');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="center-page">
      <form className="card login-card" onSubmit={submit}>
        <div>
          <h1>AI Manager HR</h1>
          <div className="muted">Sign in — admins see everything, employees see their own week and payslips.</div>
        </div>
        <label className="field">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label className="field">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="muted small">Time-clock tablet? Open the <Link to="/kiosk">kiosk</Link>.</div>
        {DEMO && (
          <div className="demo-hint">
            <b>Demo accounts</b>
            <button type="button" className="btn sm" onClick={() => { setEmail('admin@demo.ph'); setPassword('Admin123!'); }}>Owner / admin — admin@demo.ph</button>
            <button type="button" className="btn sm" onClick={() => { setEmail('manager@demo.ph'); setPassword('Manager123!'); }}>Manager — manager@demo.ph</button>
            <button type="button" className="btn sm" onClick={() => { setEmail('juan@demo.ph'); setPassword('Employee123!'); }}>Employee — juan@demo.ph</button>
            <span className="muted small">Kiosk PIN for every demo employee: 1234</span>
          </div>
        )}
      </form>
    </div>
  );
}
