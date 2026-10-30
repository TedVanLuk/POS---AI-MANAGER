import { useState } from 'react';
import { useApi } from '../hooks';
import { CODE_OPTIONS } from './roster-codes';

export interface EmployeeInput {
  employeeNo: string; firstName: string; lastName: string; position?: string | null; department?: string | null;
  branchId?: string | null; scheduleId?: string | null; payType: 'monthly' | 'daily' | 'hourly'; rate: number;
  hireDate?: string | null; tin?: string | null; sssNo?: string | null; philhealthNo?: string | null; pagibigNo?: string | null;
  allowances: { code: string; label: string; amount: number; taxable?: boolean }[];
  exemptions: { withholdingTax?: boolean; sss?: boolean; philhealth?: boolean; pagibig?: boolean };
  active?: boolean;
  phone?: string | null; facebook?: string | null; address?: string | null; idType?: string | null; idNumber?: string | null;
  weekPattern?: string[];
}

export const emptyEmployee: EmployeeInput = { employeeNo: '', firstName: '', lastName: '', payType: 'daily', rate: 0, allowances: [], exemptions: {}, weekPattern: ['D', 'D', 'D', 'D', 'D', 'O', 'O'] };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const ID_TYPES = ['PhilSys National ID', 'UMID', "Driver's licence", 'Passport', 'SSS ID', 'PhilHealth ID', 'Postal ID', "Voter's ID", 'PRC ID', 'Company ID', 'Barangay ID'];

interface Settings { settings: { departments?: { name: string; dailyRate: number }[] } }

export function EmployeeForm({ initial, onSubmit, submitLabel }: { initial: EmployeeInput; onSubmit: (e: EmployeeInput) => Promise<void>; submitLabel: string }) {
  const [f, setF] = useState<EmployeeInput>({ ...initial, weekPattern: initial.weekPattern?.length === 7 ? initial.weekPattern : emptyEmployee.weekPattern });
  const [error, setError] = useState<string | null>(null);
  const branches = useApi<{ id: string; name: string }[]>('/api/branches');
  const settings = useApi<Settings>('/api/settings');
  const departments = settings.data?.settings.departments ?? [];
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setF({ ...f, [k]: v });
  const allowance = f.allowances[0];
  const week = f.weekPattern ?? emptyEmployee.weekPattern!;
  return (
    <form className="emp-form" onSubmit={async (e) => { e.preventDefault(); try { setError(null); await onSubmit(f); } catch (err) { setError((err as Error).message); } }}>
      <fieldset>
        <legend>Job</legend>
        <div className="form-grid">
          <label className="field">Employee no.<input value={f.employeeNo} onChange={(e) => set('employeeNo', e.target.value)} required /></label>
          <label className="field">First name<input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} required /></label>
          <label className="field">Last name<input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></label>
          <label className="field">Department
            <select value={f.department ?? ''} onChange={(e) => {
              const dep = departments.find((d) => d.name === e.target.value);
              setF({ ...f, department: e.target.value || null, ...(dep && !f.rate ? { rate: dep.dailyRate, payType: 'daily' as const } : {}) });
            }}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              {f.department && !departments.some((d) => d.name === f.department) && <option value={f.department}>{f.department}</option>}
            </select>
          </label>
          <label className="field">Position<input value={f.position ?? ''} onChange={(e) => set('position', e.target.value)} placeholder="e.g. Server (Girls)" /></label>
          <label className="field">Branch<select value={f.branchId ?? ''} onChange={(e) => set('branchId', e.target.value || null)}><option value="">—</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="field">Hire date<input type="date" value={f.hireDate ?? ''} onChange={(e) => set('hireDate', e.target.value || null)} /></label>
          {initial.employeeNo && <label className="field">Status<select value={f.active === false ? 'passive' : 'active'} onChange={(e) => set('active', e.target.value === 'active')}><option value="active">Active</option><option value="passive">Passive</option></select></label>}
        </div>
      </fieldset>

      <fieldset>
        <legend>Usual week</legend>
        <div className="week-edit">
          {DAYS.map((d, i) => (
            <label key={d} className="field">{d}
              <select value={CODE_OPTIONS.some((o) => o.code === week[i]) ? week[i] : '__time'} onChange={(e) => { const w = [...week]; w[i] = e.target.value === '__time' ? '10-1' : e.target.value; set('weekPattern', w); }}>
                {CODE_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                <option value="__time">Set time…</option>
              </select>
              {!CODE_OPTIONS.some((o) => o.code === week[i]) && <input value={week[i]} onChange={(e) => { const w = [...week]; w[i] = e.target.value; set('weekPattern', w); }} aria-label={`${d} set time`} />}
            </label>
          ))}
        </div>
        <p className="muted small">Standard is 5 working days and 2 offs. Change single weeks on the Schedules page.</p>
      </fieldset>

      <fieldset>
        <legend>Pay</legend>
        <div className="form-grid">
          <label className="field">Pay type<select value={f.payType} onChange={(e) => set('payType', e.target.value as EmployeeInput['payType'])}><option value="daily">Daily rate</option><option value="monthly">Monthly salary</option><option value="hourly">Hourly rate</option></select></label>
          <label className="field">Rate (₱)<input type="number" step="0.01" min="0" value={f.rate} onChange={(e) => set('rate', Number(e.target.value))} required /></label>
          <label className="field">Allowance per cutoff (₱, non-taxable)<input type="number" min="0" value={allowance?.amount ?? 0} onChange={(e) => set('allowances', Number(e.target.value) > 0 ? [{ code: allowance?.code ?? 'allowance', label: allowance?.label ?? 'Allowance (de minimis)', amount: Number(e.target.value) }] : [])} /></label>
          <label className="field">TIN<input value={f.tin ?? ''} onChange={(e) => set('tin', e.target.value)} /></label>
          <label className="field">SSS no.<input value={f.sssNo ?? ''} onChange={(e) => set('sssNo', e.target.value)} /></label>
          <label className="field">PhilHealth no.<input value={f.philhealthNo ?? ''} onChange={(e) => set('philhealthNo', e.target.value)} /></label>
          <label className="field">Pag-IBIG no.<input value={f.pagibigNo ?? ''} onChange={(e) => set('pagibigNo', e.target.value)} /></label>
        </div>
        <div className="row" style={{ marginTop: '.6rem' }}>
          <span className="muted small">Exempt from:</span>
          {(['withholdingTax', 'sss', 'philhealth', 'pagibig'] as const).map((k) => (
            <label key={k} className="row small" style={{ gap: '.3rem' }}><input type="checkbox" checked={!!f.exemptions[k]} onChange={(e) => set('exemptions', { ...f.exemptions, [k]: e.target.checked })} />{{ withholdingTax: 'Withholding tax (MWE)', sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG' }[k]}</label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Contact & ID</legend>
        <div className="form-grid">
          <label className="field">Phone<input type="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="09xx xxx xxxx" /></label>
          <label className="field">Facebook<input value={f.facebook ?? ''} onChange={(e) => set('facebook', e.target.value)} placeholder="facebook.com/… or name" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Address<input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
          <label className="field">ID type<select value={f.idType ?? ''} onChange={(e) => set('idType', e.target.value || null)}><option value="">—</option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field">ID number<input value={f.idNumber ?? ''} onChange={(e) => set('idNumber', e.target.value)} /></label>
        </div>
        <p className="muted small">Upload the ID picture and mark it verified on the employee's "ID & contact" tab.</p>
      </fieldset>
      {error && <div className="error" style={{ marginTop: '.5rem' }}>{error}</div>}
      <div style={{ marginTop: '1rem' }}><button className="btn primary">{submitLabel}</button></div>
    </form>
  );
}
