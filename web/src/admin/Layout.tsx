import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Avatar, Icon, type IconName } from '../components/Icon';
import { useTheme } from '../theme';

interface Emp { id: string; firstName: string; lastName: string; employeeNo: string; position: string | null; active: boolean; photoUrl?: string | null }

export default function AdminLayout() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const groups: { title: string; links: [string, string, IconName, boolean][] }[] = [
    { title: 'Overview', links: [
      ['/admin', 'Dashboard', 'home', true],
      ['/admin/ai', 'AI Manager', 'spark', isAdmin(me?.role)],
    ] },
    { title: 'People', links: [
      ['/admin/employees', 'Employees List', 'users', true],
      ['/admin/performance', 'Employee cards', 'trophy', true],
      ['/admin/schedules', 'Schedules', 'calendar', true],
      ['/admin/attendance', 'Attendance', 'clock', true],
    ] },
    { title: 'Pay', links: [
      ['/admin/payroll', 'Payroll', 'wallet', true],
      ['/admin/efficiency', 'Server efficiency', 'receipt', true],
    ] },
    { title: 'System', links: [
      ['/admin/settings', 'Settings', 'settings', isAdmin(me?.role)],
    ] },
  ];
  return (
    <div className="app">
      <div className="frame">
        <nav className="rail" aria-label="Main menu">
          <div className="brand"><div className="logo" aria-hidden><span>AIM</span></div><div><b>AI Manager HR</b><span>{me?.tenantName}</span></div></div>
          {groups.map((g) => {
            const visible = g.links.filter((l) => l[3]);
            if (!visible.length) return null;
            return (
              <div key={g.title} style={{ display: 'contents' }}>
                <div className="group">{g.title}</div>
                {visible.map(([to, label, icon]) => (
                  <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`}>
                    <span className="ico"><Icon name={icon} /></span><span>{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
          <div className="bottom">
            <button className="rail-item" onClick={() => { logout(); nav('/login'); }}>
              <span className="ico"><Icon name="logout" /></span><span>Sign out</span>
            </button>
          </div>
        </nav>
        <main className="main">
          <TopBar />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const emps = useApi<Emp[]>('/api/employees');
  const pending = useApi<unknown[]>('/api/penalties?status=pending');
  const [now, setNow] = useState(new Date());
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { void pending.reload(); setMenu(false); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const tz = me?.timezone;
  const date = now.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz });
  const time = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const hour = Number(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }));
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return (emps.data ?? []).filter((e) => `${e.firstName} ${e.lastName} ${e.employeeNo} ${e.position ?? ''}`.toLowerCase().includes(s)).slice(0, 6);
  }, [q, emps.data]);
  const open = (id: string) => { setQ(''); nav(`/admin/employees/${id}`); };
  const pendingCount = pending.data?.length ?? 0;

  return (
    <header className="topbar">
      <div className="today">
        <div className="date">{date}</div>
        <div className="clock"><Icon name={hour >= 6 && hour < 18 ? 'sun' : 'moon'} />{time}</div>
      </div>
      <div className="search-pill" role="search">
        <Icon name="search" />
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Search employees by name, number or position…" aria-label="Search employees"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
            if (e.key === 'Enter' && results[sel]) open(results[sel].id);
            if (e.key === 'Escape') setQ('');
          }}
        />
        <kbd>{emps.data ? `${emps.data.filter((e) => e.active).length} staff` : '…'}</kbd>
        {q.trim() && (
          <div className="search-results">
            {results.length === 0 && <div className="muted small" style={{ padding: '.5rem .6rem' }}>No employee matches “{q}”.</div>}
            {results.map((e, i) => (
              <button key={e.id} className={i === sel ? 'on' : ''} onMouseDown={(ev) => { ev.preventDefault(); open(e.id); }}>
                <Avatar name={`${e.firstName} ${e.lastName}`} photo={e.photoUrl} />
                <span><b>{e.firstName} {e.lastName}</b><br /><span className="muted small">{e.employeeNo} · {e.position}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="top-actions">
        <button className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="icon-btn" onClick={() => nav('/admin/payroll?tab=penalties')} aria-label={`${pendingCount} penalties waiting for a decision`} title="Penalties waiting for a decision">
          <Icon name="bell" />{pendingCount > 0 && <span className="dot">{pendingCount > 99 ? '99+' : pendingCount}</span>}
        </button>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button className="profile-chip" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
            <Avatar name={me?.name ?? '?'} />
            <span className="who"><b>{me?.name.replace(/\s*\(.*\)$/, '')}</b><span>{me?.role} · {me?.tenantName}</span></span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => nav('/kiosk')}><Icon name="tablet" />Open time clock</button>
              {me?.employeeId && <button role="menuitem" onClick={() => nav('/me')}><Icon name="user" />My page</button>}
              <button role="menuitem" onClick={toggle}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
              <button role="menuitem" onClick={() => { logout(); nav('/login'); }}><Icon name="logout" />Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
