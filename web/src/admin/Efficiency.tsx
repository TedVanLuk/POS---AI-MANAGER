import { useState } from 'react';
import { api, daysAgoIso, peso, todayIso } from '../api';
import { useApi } from '../hooks';
import { Modal } from '../components/Modal';

interface Server { employeeId: string; name: string; slips: number; voids: number; voidRate: number; sales: number; avgTicket: number; items: number; avgServiceMinutes: number | null; avgCloseMinutes: number | null; hoursWorked: number; slipsPerHour: number; salesPerHour: number }
interface Eff { servers: Server[]; serialGaps: { prefix: string; missing: string[]; range: [string, string] }[] }

/** Server (waiter) efficiency from order slips — OS serials entered by each server. */
export default function Efficiency() {
  const [from, setFrom] = useState(daysAgoIso(13));
  const [to, setTo] = useState(todayIso());
  const data = useApi<Eff>(`/api/efficiency?from=${from}&to=${to}`);
  const employees = useApi<{ id: string; firstName: string; lastName: string; position: string | null }[]>('/api/employees');
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [single, setSingle] = useState({ serverEmployeeId: '', serialNo: '', tableNo: '', amount: '', openedAt: '', servedAt: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const importCsv = async () => {
    // serial,server_employee_no,opened_at,served_at,closed_at,amount,items,status
    const byNo = new Map((await api.get<{ id: string; employeeNo: string }[]>('/api/employees')).map((e) => [e.employeeNo, e.id]));
    const slips = csv.trim().split('\n').filter((l) => l && !l.startsWith('serial')).map((l) => {
      const [serialNo, no, openedAt, servedAt, closedAt, amount, items, status] = l.split(',').map((x) => x.trim());
      return { serialNo, serverEmployeeId: byNo.get(no), openedAt: new Date(openedAt).toISOString(), servedAt: servedAt ? new Date(servedAt).toISOString() : null, closedAt: closedAt ? new Date(closedAt).toISOString() : null, amount: Number(amount || 0), itemsCount: Number(items || 0), status: status || 'closed' };
    });
    const r = await api.post<{ inserted: number; skippedDuplicates: number }>('/api/order-slips', { slips });
    setMsg(`Imported ${r.inserted} slips (${r.skippedDuplicates} duplicates skipped)`);
  };

  return (
    <>
      <div className="page-head">
        <h1>Server efficiency</h1>
        <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setOpen(true)}>+ Enter / import OS</button>
      </div>
      {msg && <div className="badge info" style={{ marginBottom: '.75rem' }}>{msg}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>#</th><th>Server</th><th className="num">OS count</th><th className="num">Sales</th><th className="num">Avg ticket</th><th className="num">Avg serve time</th><th className="num">OS / hour</th><th className="num">Sales / hour</th><th className="num">Voids</th><th className="num">Hours</th></tr></thead>
          <tbody>
            {data.data?.servers.map((s, i) => (
              <tr key={s.employeeId}>
                <td>{i + 1}</td>
                <td><b>{s.name}</b></td>
                <td className="num">{s.slips}</td>
                <td className="num">{peso(s.sales)}</td>
                <td className="num">{peso(s.avgTicket)}</td>
                <td className="num">{s.avgServiceMinutes != null ? `${s.avgServiceMinutes.toFixed(1)} min` : '—'}</td>
                <td className="num">{s.slipsPerHour.toFixed(2)}</td>
                <td className="num">{peso(s.salesPerHour)}</td>
                <td className="num">{s.voids ? <span className={`badge ${s.voidRate > 0.03 ? 'bad' : 'warn'}`}>{s.voids} ({(s.voidRate * 100).toFixed(1)}%)</span> : '0'}</td>
                <td className="num">{s.hoursWorked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2>Order-slip serial check</h2>
        {data.data?.serialGaps.length === 0 && <div><span className="badge good">✓ No missing serial numbers</span></div>}
        {data.data?.serialGaps.map((g) => (
          <div key={g.prefix}>
            <span className="badge warn">! {g.missing.length} missing</span> in range {g.range[0]} – {g.range[1]}:
            <div className="small" style={{ marginTop: '.4rem', fontFamily: 'ui-monospace, monospace' }}>{g.missing.join(', ')}</div>
            <p className="muted small">Missing serials can mean lost, unrecorded or unreported slips — check the physical pads for these numbers.</p>
          </div>
        ))}
      </div>
      {open && (
        <Modal title="Order slips" onClose={() => setOpen(false)} actions={<button className="btn" onClick={() => setOpen(false)}>Close</button>}>
          <h3>Single OS</h3>
          <div className="form-grid">
            <label className="field">Server<select value={single.serverEmployeeId} onChange={(e) => setSingle({ ...single, serverEmployeeId: e.target.value })}><option value="">Select…</option>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label>
            <label className="field">OS serial<input value={single.serialNo} onChange={(e) => setSingle({ ...single, serialNo: e.target.value })} placeholder="OS-002100" /></label>
            <label className="field">Table<input value={single.tableNo} onChange={(e) => setSingle({ ...single, tableNo: e.target.value })} /></label>
            <label className="field">Amount<input type="number" value={single.amount} onChange={(e) => setSingle({ ...single, amount: e.target.value })} /></label>
            <label className="field">Opened<input type="datetime-local" value={single.openedAt} onChange={(e) => setSingle({ ...single, openedAt: e.target.value })} /></label>
            <label className="field">Served<input type="datetime-local" value={single.servedAt} onChange={(e) => setSingle({ ...single, servedAt: e.target.value })} /></label>
          </div>
          <button className="btn primary" style={{ marginTop: '.5rem' }} onClick={async () => {
            try {
              const r = await api.post<{ inserted: number }>('/api/order-slips', { ...single, amount: Number(single.amount || 0), openedAt: new Date(single.openedAt).toISOString(), servedAt: single.servedAt ? new Date(single.servedAt).toISOString() : null, closedAt: single.servedAt ? new Date(single.servedAt).toISOString() : null });
              setMsg(r.inserted ? 'OS saved' : 'Duplicate serial — not saved'); await data.reload();
            } catch (e) { setMsg((e as Error).message); }
          }}>Save OS</button>
          <h3 style={{ marginTop: '1rem' }}>Bulk CSV (POS export)</h3>
          <p className="muted small">Columns: serial, employee_no, opened_at, served_at, closed_at, amount, items, status</p>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="OS-002101,E-001,2026-10-28 12:01,2026-10-28 12:12,2026-10-28 12:50,1250,4,closed" />
          <button className="btn" onClick={async () => { try { await importCsv(); await data.reload(); } catch (e) { setMsg((e as Error).message); } }}>Import CSV</button>
        </Modal>
      )}
    </>
  );
}
