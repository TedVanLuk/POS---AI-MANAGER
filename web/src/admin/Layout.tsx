import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { isAdmin, useAuth } from '../auth';

export default function AdminLayout() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const links: [string, string, boolean][] = [
    ['/admin', '📊 Dashboard', true],
    ['/admin/attendance', '🕘 Attendance', true],
    ['/admin/employees', '👥 Employees', true],
    ['/admin/payroll', '💸 Payroll', true],
    ['/admin/penalties', '⚖️ Penalties', true],
    ['/admin/efficiency', '🧾 Server efficiency', true],
    ['/admin/performance', '🥊 Fighter cards', true],
    ['/admin/ai', '🤖 AI Manager', isAdmin(me?.role)],
    ['/admin/settings', '⚙️ Settings', isAdmin(me?.role)],
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AI Manager HR<small>{me?.tenantName}</small></div>
        <nav className="nav">
          {links.filter((l) => l[2]).map(([to, label]) => <NavLink key={to} to={to} end={to === '/admin'}>{label}</NavLink>)}
        </nav>
        <div className="spacer" />
        <div className="small" style={{ padding: '.5rem' }}>
          <div style={{ color: '#fff' }}>{me?.name}</div>
          <div style={{ opacity: .7, textTransform: 'capitalize' }}>{me?.role}</div>
          <div className="row" style={{ marginTop: '.5rem' }}>
            <a href="/kiosk" style={{ color: 'var(--sidebar-text)' }}>Kiosk</a>
            {me?.employeeId && <a href="/me" style={{ color: 'var(--sidebar-text)' }}>My page</a>}
            <button className="btn sm" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
