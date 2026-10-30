import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Modal } from '../components/Modal';
import { EmployeeForm, emptyEmployee } from './EmployeeForm';

interface Row { id: string; employeeNo: string; firstName: string; lastName: string; position: string | null; branchName: string | null; scheduleName: string | null; payType: string; rate: number; active: boolean; fingerprints: number; biometricConsentAt: string | null }

export default function Employees() {
  const { me } = useAuth();
  const nav = useNavigate();
  const list = useApi<Row[]>('/api/employees');
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const [adding, setAddingState] = useState(params.get('add') === '1');
  const setAdding = (v: boolean) => { setAddingState(v); if (!v && params.get('add')) setParams({}, { replace: true }); };
  const rows = (list.data ?? []).filter((r) => `${r.firstName} ${r.lastName} ${r.employeeNo} ${r.position}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <h1>Employees</h1>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="spacer" />
        {isAdmin(me?.role) && <button className="btn primary" onClick={() => setAdding(true)}>+ Add employee</button>}
      </div>
      {list.error && <div className="error">{list.error}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>No.</th><th>Name</th><th>Position</th><th>Branch</th><th>Schedule</th><th>Pay</th><th>Fingerprint</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/admin/employees/${r.id}`)}>
                <td>{r.employeeNo}</td>
                <td><b>{r.firstName} {r.lastName}</b></td>
                <td>{r.position}</td>
                <td>{r.branchName ?? '—'}</td>
                <td>{r.scheduleName ?? 'Default'}</td>
                <td>{peso(r.rate)} <span className="muted small">/{r.payType === 'monthly' ? 'mo' : r.payType === 'daily' ? 'day' : 'hr'}</span></td>
                <td>{r.fingerprints > 0 ? <span className="badge good">✓ {r.fingerprints} enrolled</span> : r.biometricConsentAt ? <span className="badge warn">! Not enrolled</span> : <span className="badge">No consent</span>}</td>
                <td>{r.active ? <span className="badge good">Active</span> : <span className="badge">Inactive</span>}</td>
              </tr>
            ))}
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
