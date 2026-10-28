import { useState } from 'react';
import { Link } from 'react-router-dom';
import { daysAgoIso, hm, todayIso } from '../api';
import { useApi } from '../hooks';

export interface DayRec {
  date: string; weekday: number; dayType: string; present: boolean; absent: boolean; firstIn: string | null; lastOut: string | null;
  workedMinutes: number; regularMinutes: number; overtimeMinutes: number; nightDiffMinutes: number; nightDiffOtMinutes: number;
  lateMinutes: number; undertimeMinutes: number; missingOut: boolean; missingIn: boolean;
}
interface Totals { scheduledDays: number; daysPresent: number; daysAbsent: number; lateCount: number; lateMinutes: number; undertimeMinutes: number; overtimeMinutes: number; nightDiffMinutes: number; workedMinutes: number; missingPunches: number }
interface Row { employeeId: string; name: string; employeeNo: string; totals: Totals; days: DayRec[] }

/** Team timesheet: one row per employee, one cell per day. */
export default function Attendance() {
  const [from, setFrom] = useState(daysAgoIso(13));
  const [to, setTo] = useState(todayIso());
  const data = useApi<Row[]>(`/api/attendance/records?from=${from}&to=${to}`);
  const dates = data.data?.[0]?.days.map((d) => d.date) ?? [];
  return (
    <>
      <div className="page-head">
        <h1>Attendance</h1>
        <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <p className="muted small">✓ on time · ⏱ late (minutes) · ✕ absent · ! missing time-out · – rest day · ★ holiday. Click an employee to correct punches.</p>
      {data.error && <div className="error">{data.error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Employee</th>{dates.map((d) => <th key={d} className="num">{d.slice(5)}</th>)}<th className="num">Present</th><th className="num">Lates</th><th className="num">Late min</th><th className="num">OT</th><th className="num">Absent</th></tr>
          </thead>
          <tbody>
            {data.data?.map((r) => (
              <tr key={r.employeeId}>
                <td><Link to={`/admin/employees/${r.employeeId}`}>{r.name}</Link></td>
                {r.days.map((d) => (
                  <td key={d.date} className="num" title={`${d.date}: ${d.dayType}${d.lateMinutes ? `, late ${d.lateMinutes}m` : ''}`}>
                    {d.missingOut ? <span className="badge warn">!</span> : d.absent ? <span className="badge bad">✕</span> : d.lateMinutes ? <span className="badge warn">⏱{d.lateMinutes}</span> : d.present ? '✓' : d.dayType.includes('rest') ? <span className="muted">–</span> : d.dayType !== 'ordinary' ? '★' : <span className="muted">·</span>}
                  </td>
                ))}
                <td className="num">{r.totals.daysPresent}</td>
                <td className="num">{r.totals.lateCount}</td>
                <td className="num">{r.totals.lateMinutes}</td>
                <td className="num">{hm(r.totals.overtimeMinutes)}</td>
                <td className="num">{r.totals.daysAbsent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
