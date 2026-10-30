import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Avatar } from '../components/Icon';
import { Modal } from '../components/Modal';
import { EmployeeForm, emptyEmployee } from './EmployeeForm';
import { codeInfo, isOnDuty, monthlyFromDaily, workWeek } from './roster-codes';

interface Row {
  id: string; employeeNo: string; firstName: string; lastName: string; position: string | null; department: string | null; branchName: string | null;
  payType: 'daily' | 'monthly' | 'hourly'; rate: number; active: boolean; photoUrl?: string | null; weekPattern?: string[];
  phone?: string | null; facebook?: string | null; address?: string | null; idType?: string | null; idNumber?: string | null; hasIdPhoto?: boolean; idVerifiedAt?: string | null;
}
const DAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Employees List: the team at a glance — job, schedule, pay, status, ID verification and contact. */
export default function Employees() {
  const { me } = useAuth();
  const nav = useNavigate();
  const list = useApi<Row[]>('/api/employees');
  const [params, setParams] = useSearchParams();
  const [adding, setAddingState] = useState(params.get('add') === '1');
  const setAdding = (v: boolean) => { setAddingState(v); if (!v && params.get('add')) setParams({}, { replace: true }); };
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'passive'>('active');
  const departments = useMemo(() => [...new Set((list.data ?? []).map((r) => r.department ?? 'Unassigned'))], [list.data]);
  const rows = (list.data ?? []).filter((r) =>
    (status === 'all' || (status === 'active') === r.active) &&
    (!dept || (r.department ?? 'Unassigned') === dept) &&
    `${r.firstName} ${r.lastName} ${r.employeeNo} ${r.position ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const counts = { active: (list.data ?? []).filter((r) => r.active).length, passive: (list.data ?? []).filter((r) => !r.active).length };
  const verified = (list.data ?? []).filter((r) => r.idVerifiedAt).length;

  return (
    <>
      <div className="page-head">
        <h1>Employees List</h1>
        <span className="muted">{counts.active} active · {counts.passive} passive · {verified} IDs verified</span>
        <div className="spacer" />
        {isAdmin(me?.role) && <button className="btn primary" onClick={() => setAdding(true)}>+ Add employee</button>}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search name, number, position or phone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} aria-label="Search employees" />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
        <div className="seg" role="group" aria-label="Status">
          {(['active', 'passive', 'all'] as const).map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Passive'}</button>)}
        </div>
        <span className="muted small">{rows.length} shown</span>
      </div>
      {list.error && <div className="error">{list.error}</div>}
      <div className="card table-wrap" style={{ padding: '6px 10px' }}>
        <table className="emp-list">
          <thead>
            <tr><th>No.</th><th>Name</th><th>Position</th><th>Branch</th><th>Schedule</th><th className="num">Pay</th><th>Status</th><th>Working ID</th><th>Contact</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const w = workWeek(r.weekPattern);
              const daily = r.payType === 'daily' ? r.rate : r.payType === 'hourly' ? r.rate * 8 : null;
              const monthly = r.payType === 'monthly' ? r.rate : daily !== null ? monthlyFromDaily(daily, w.days || 5) : null;
              const name = `${r.firstName} ${r.lastName}`.trim();
              return (
                <tr key={r.id} className="clickable" onClick={() => nav(`/admin/employees/${r.id}`)}>
                  <td className="muted">{r.employeeNo}</td>
                  <td><span className="row" style={{ gap: '.55rem', flexWrap: 'nowrap' }}><Avatar name={name} photo={r.photoUrl} /><b>{name}</b></span></td>
                  <td>{r.position ?? '—'}<div className="muted small">{r.department}</div></td>
                  <td>{r.branchName ?? '—'}</td>
                  <td>
                    {r.weekPattern?.length === 7 ? (
                      <>
                        <div className="mini-week" aria-label={r.weekPattern.map((c, i) => `${DAY[i]} ${codeInfo(c).label}`).join(', ')}>
                          {r.weekPattern.map((c, i) => <span key={i} className={`mw ${isOnDuty(c) ? 'on' : codeInfo(c).cls}`} title={codeInfo(c).label}>{DAY[i]}</span>)}
                        </div>
                        <div className={`small ${w.days === 5 ? 'muted' : ''}`} style={w.days !== 5 ? { color: 'var(--warning-text)' } : undefined}>{w.days} days · {w.offs} off</div>
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="num">
                    {daily !== null && <div><b>{peso(daily)}</b><span className="muted small"> /day</span></div>}
                    {monthly !== null && <div className="muted small">{peso(monthly)} /month</div>}
                  </td>
                  <td>{r.active ? <span className="badge good">Active</span> : <span className="badge">Passive</span>}</td>
                  <td>
                    {r.idVerifiedAt ? <span className="badge good">✓ Verified</span> : r.hasIdPhoto ? <span className="badge warn">! To verify</span> : <span className="badge">No ID yet</span>}
                    {r.idType && <div className="muted small">{r.idType}{r.idNumber ? ` · ${r.idNumber}` : ''}</div>}
                  </td>
                  <td className="contact">
                    {r.phone && <div>{r.phone}</div>}
                    {r.facebook && <div className="muted small">FB: {r.facebook}</div>}
                    {r.address && <div className="muted small ellipsis" title={r.address}>{r.address}</div>}
                    {!r.phone && !r.facebook && !r.address && <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="muted">No employees match.</td></tr>}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal title="Add employee" onClose={() => setAdding(false)} actions={<button className="btn" onClick={() => setAdding(false)}>Cancel</button>}>
          <EmployeeForm initial={emptyEmployee} submitLabel="Create employee" onSubmit={async (e) => {
            const created = await api.post<{ id: string }>('/api/employees', e);
            setAdding(false);
            nav(`/admin/employees/${created.id}`);
          }} />
        </Modal>
      )}
    </>
  );
}
