import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { peso } from '../api';
import { isStaff, useAuth } from '../auth';
import { useApi } from '../hooks';
import { EmployeeCard, type CardData } from '../components/EmployeeCard';
import { WeekStrip, type Week } from '../components/WeekStrip';

interface Payslip { id: string; periodStart: string; periodEnd: string; payDate: string | null; gross: number; totalDeductions: number; net: number; lines: { code: string; label: string; category: string; quantity: number | null; amount: number }[] }

/** Employee self-service: this week (days & lates), own card, approved payslips, shared notes. */
export default function MePage() {
  const { me, loading, logout } = useAuth();
  const nav = useNavigate();
  const week = useApi<Week>(me?.employeeId ? '/api/me/week' : null);
  const card = useApi<CardData>(me?.employeeId ? '/api/me/card' : null);
  const slips = useApi<Payslip[]>(me?.employeeId ? '/api/me/payslips' : null);
  const notes = useApi<{ id: string; title: string; body: string; category: string }[]>(me?.employeeId ? '/api/me/notes' : null);
  const [open, setOpen] = useState<string | null>(null);
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (!me.employeeId) return <Navigate to={isStaff(me.role) ? '/admin' : '/login'} replace />;
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '1.25rem' }}>
      <div className="page-head">
        <div><h1>Hi, {me.name.split(' ')[0]} 👋</h1><div className="muted">{me.tenantName}</div></div>
        <div className="spacer" />
        {isStaff(me.role) && <button className="btn" onClick={() => nav('/admin')}>Admin</button>}
        <button className="btn" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
      </div>
      <div className="card"><h2>This week</h2>{week.data ? <WeekStrip week={week.data} /> : <div className="muted">Loading…</div>}</div>
      <div className="row" style={{ alignItems: 'flex-start', marginTop: '1rem', gap: '1rem' }}>
        {card.data && <EmployeeCard card={card.data} />}
        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <h2>Payslips</h2>
          {slips.data?.length === 0 && <div className="muted">No approved payslips yet.</div>}
          {slips.data?.map((s) => (
            <div key={s.id} style={{ borderBottom: '1px solid var(--border)', padding: '.5rem 0' }}>
              <div className="row clickable" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <b>{s.periodStart} → {s.periodEnd}</b><div className="spacer" /><b>{peso(s.net)}</b><span className="muted">{open === s.id ? '▲' : '▼'}</span>
              </div>
              {open === s.id && (
                <table style={{ marginTop: '.5rem' }}><tbody>
                  {s.lines.filter((l) => l.category !== 'info').map((l) => <tr key={l.code}><td>{l.label}</td><td className="num">{l.category === 'deduction' ? '− ' : ''}{peso(l.amount)}</td></tr>)}
                  <tr><td><b>Net pay</b></td><td className="num"><b>{peso(s.net)}</b></td></tr>
                </tbody></table>
              )}
            </div>
          ))}
          {!!notes.data?.length && (<><h2 style={{ marginTop: '1rem' }}>Notes from management</h2>{notes.data.map((n) => <div key={n.id} style={{ marginBottom: '.5rem' }}><span className="badge">{n.category}</span> <b>{n.title}</b><div className="small">{n.body}</div></div>)}</>)}
        </div>
      </div>
    </div>
  );
}
