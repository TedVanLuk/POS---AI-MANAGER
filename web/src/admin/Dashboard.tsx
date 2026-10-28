import { Link } from 'react-router-dom';
import { fmtTime, hm, peso } from '../api';
import { useApi } from '../hooks';
import { TrendChart, type TrendPoint } from '../components/TrendChart';

interface Dash {
  activeEmployees: number; attendanceRate: number | null; pendingPenalties: number;
  last14: { lateCount: number; lateMinutes: number; overtimeMinutes: number; daysAbsent: number; missingPunches: number };
  lastRun: { id: string; periodStart: string; periodEnd: string; status: string; net: number } | null;
  trend: TrendPoint[];
}
interface Today {
  date: string; counts: { total: number; clockedIn: number; late: number; notIn: number };
  rows: { employeeId: string; name: string; position: string | null; status: string; lastPunchAt: string | null; record: { lateMinutes: number; firstIn: string | null } }[];
}

const STATUS: Record<string, [string, string]> = {
  in: ['good', '● Clocked in'], out: ['info', '○ Clocked out'], not_in: ['bad', '✕ Not in'], rest_day: ['', '– Rest day'], holiday: ['info', '★ Holiday'],
};

export default function Dashboard() {
  const dash = useApi<Dash>('/api/dashboard');
  const today = useApi<Today>('/api/attendance/today');
  const d = dash.data;
  const t = today.data;
  return (
    <>
      <div className="page-head"><h1>Dashboard</h1><span className="muted">{t?.date}</span><div className="spacer" /><button className="btn" onClick={() => { void dash.reload(); void today.reload(); }}>Refresh</button></div>
      {(dash.error || today.error) && <div className="error">{dash.error ?? today.error}</div>}
      <div className="grid cols-4">
        <div className="card stat"><div className="label">Clocked in now</div><div className="value">{t ? `${t.counts.clockedIn} / ${t.counts.total}` : '—'}</div></div>
        <div className="card stat"><div className="label">Late today</div><div className="value">{t?.counts.late ?? '—'}</div></div>
        <div className="card stat"><div className="label">Attendance rate (14 days)</div><div className="value">{d?.attendanceRate != null ? `${Math.round(d.attendanceRate * 100)}%` : '—'}</div></div>
        <div className="card stat"><div className="label">Lates (14 days)</div><div className="value">{d?.last14.lateCount ?? '—'}</div><div className="muted small">{d ? hm(d.last14.lateMinutes) : ''} total</div></div>
        <div className="card stat"><div className="label">Overtime (14 days)</div><div className="value">{d ? hm(d.last14.overtimeMinutes) : '—'}</div></div>
        <div className="card stat"><div className="label">Pending penalties</div><div className="value"><Link to="/admin/penalties">{d?.pendingPenalties ?? '—'}</Link></div></div>
        <div className="card stat"><div className="label">Last payroll net</div><div className="value" style={{ fontSize: '1.3rem' }}>{d?.lastRun ? <Link to={`/admin/payroll/${d.lastRun.id}`}>{peso(d.lastRun.net)}</Link> : '—'}</div><div className="muted small">{d?.lastRun ? `${d.lastRun.periodStart} → ${d.lastRun.periodEnd} · ${d.lastRun.status}` : 'No runs yet'}</div></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: '1rem' }}>
        <div className="card"><h2>Attendance — last 14 days</h2>{d && <TrendChart data={d.trend} />}</div>
        <div className="card">
          <h2>Today</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Employee</th><th>Status</th><th>Time in</th><th className="num">Late</th></tr></thead>
            <tbody>
              {t?.rows.map((r) => {
                const [cls, label] = STATUS[r.status] ?? ['', r.status];
                return (
                  <tr key={r.employeeId}>
                    <td><Link to={`/admin/employees/${r.employeeId}`}>{r.name}</Link><div className="muted small">{r.position}</div></td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td>{fmtTime(r.record.firstIn)}</td>
                    <td className="num">{r.record.lateMinutes ? <span className="badge warn">⏱ {r.record.lateMinutes}m</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
