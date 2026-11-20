import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, DEMO } from '../api';
import { isAdmin, isStaff, useAuth } from '../auth';
import { Icon, type IconName } from '../components/Icon';
import GuestProfile from '../marketing/GuestProfile';
import Counter from '../marketing/Counter';
import Tonight from '../marketing/Tonight';
import Campaigns from '../marketing/Campaigns';
import Automations from '../marketing/Automations';
import MarketingSettings from '../marketing/MarketingSettings';
import Overview from './Overview';
import Customers from './Customers';
import Spending from './Spending';
import './crm.css';

/** AI Marketing CRM: a separate app for the venue's customers, with its own look (gold on black). */
export default function CrmApp({ standalone }: { standalone?: boolean }) {
  return (
    <div className="crm">
      <Routes>
        <Route path="login" element={<CrmLogin standalone={standalone} />} />
        <Route element={<RequireStaff><CrmLayout standalone={standalone} /></RequireStaff>}>
          <Route index element={<Overview />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<GuestProfile />} />
          <Route path="spending" element={<Spending />} />
          <Route path="tonight" element={<Tonight />} />
          <Route path="counter" element={<Counter />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="automations" element={<Automations />} />
          <Route path="settings" element={<MarketingSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/crm" replace />} />
      </Routes>
    </div>
  );
}

function RequireStaff({ children }: { children: JSX.Element }) {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (!me || !isStaff(me.role)) return <Navigate to="/crm/login" replace />;
  return children;
}

const NAV: { to: string; label: string; icon: IconName; admin?: boolean }[] = [
  { to: '/crm', label: 'Command center', icon: 'home' },
  { to: '/crm/customers', label: 'Customer database', icon: 'users' },
  { to: '/crm/spending', label: 'Spending performance', icon: 'wallet' },
  { to: '/crm/tonight', label: 'Tonight & tables', icon: 'calendar' },
  { to: '/crm/counter', label: 'Counter check-in', icon: 'phone' },
  { to: '/crm/campaigns', label: 'Campaigns', icon: 'send' },
  { to: '/crm/automations', label: 'Automations', icon: 'repeat' },
  { to: '/crm/settings', label: 'Settings', icon: 'settings', admin: true },
];

interface Hit { id: string; name: string; phoneDisplay: string; tier: string | null; spend365: number }

function CrmLayout({ standalone }: { standalone?: boolean }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [now, setNow] = useState(new Date());
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { try { setHits((await api.get<{ customers: Hit[] }>(`/api/crm/customers?q=${encodeURIComponent(q.trim())}`)).customers.slice(0, 7)); setSel(0); } catch { setHits([]); } }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (id: string) => { setQ(''); setHits([]); nav(`/crm/customers/${id}`); };
  const tz = me?.timezone;
  const links = useMemo(() => NAV.filter((l) => !l.admin || isAdmin(me?.role)), [me?.role]);

  return (
    <div className="cx-app">
      <aside className={`cx-rail ${open ? 'open' : ''}`}>
        <div className="cx-brand"><span className="cx-logo" aria-hidden><svg viewBox="0 0 20 20"><path d="M10 1 19 10 10 19 1 10z" /></svg></span><div><b>AI Marketing</b><span>Customer CRM</span></div></div>
        <nav aria-label="CRM">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === '/crm'} className={({ isActive }) => `cx-nav ${isActive ? 'on' : ''}`}><Icon name={l.icon} /><span>{l.label}</span></NavLink>
          ))}
        </nav>
        <div className="cx-rail-foot">
          {!standalone && <button className="cx-nav" onClick={() => nav('/admin')}><Icon name="org" /><span>Switch to HR</span></button>}
          <button className="cx-nav" onClick={() => { logout(); nav('/crm/login'); }}><Icon name="logout" /><span>Sign out</span></button>
        </div>
      </aside>
      {open && <button className="cx-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="cx-main">
        <header className="cx-top">
          <button className="cx-burger" aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
          <div className="cx-venue"><b>{me?.tenantName}</b><span>{now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })} · {now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz })}</span></div>
          <div className="cx-search" role="search">
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer — name, mobile or email" aria-label="Find a customer"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, hits.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
                if (e.key === 'Enter' && hits[sel]) go(hits[sel].id);
                if (e.key === 'Escape') setQ('');
              }} />
            {q.trim().length >= 2 && (
              <div className="cx-hits">
                {!hits.length && <div className="cx-muted">No customer matches “{q}”.</div>}
                {hits.map((h, i) => <button key={h.id} className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); go(h.id); }}><b>{h.name}</b><span>{h.phoneDisplay}{h.tier ? ` · ${h.tier}` : ''}</span><em>₱{Math.round(h.spend365).toLocaleString('en-PH')}</em></button>)}
              </div>
            )}
          </div>
          <div className="cx-user"><span className="cx-avatar">{(me?.name ?? '?').slice(0, 1)}</span><div><b>{me?.name.replace(/\s*\(.*\)$/, '')}</b><span>{me?.role}</span></div></div>
        </header>
        <main className="cx-content"><Outlet /></main>
      </div>
    </div>
  );
}

function CrmLogin({ standalone }: { standalone?: boolean }) {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me && isStaff(me.role)) return <Navigate to="/crm" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const m = await login(email, password); if (!isStaff(m.role)) { setErr('The CRM is for owners, admins and managers.'); return; } nav('/crm'); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="cx-login">
      <form onSubmit={submit} className="cx-login-card">
        <div className="cx-brand big"><span className="cx-logo" aria-hidden><svg viewBox="0 0 20 20"><path d="M10 1 19 10 10 19 1 10z" /></svg></span><div><b>AI Marketing</b><span>Customer CRM for venues</span></div></div>
        <p className="cx-muted">Know every customer, see what they spend, and bring them back.</p>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="error">{err}</div>}
        <button className="cx-btn gold" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {DEMO && <div className="cx-demo-acc"><span>Demo accounts</span>
          <button type="button" onClick={() => { setEmail('admin@demo.ph'); setPassword('Admin123!'); }}>Owner — admin@demo.ph</button>
          <button type="button" onClick={() => { setEmail('manager@demo.ph'); setPassword('Manager123!'); }}>Manager — manager@demo.ph</button></div>}
        {!standalone && <a className="cx-muted small" href="/login" onClick={(e) => { e.preventDefault(); nav('/login'); }}>HR & payroll sign-in →</a>}
      </form>
    </div>
  );
}
