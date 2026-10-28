import { useState } from 'react';
import { useApi } from '../hooks';

export interface EmployeeInput {
  employeeNo: string; firstName: string; lastName: string; position?: string | null; department?: string | null;
  branchId?: string | null; scheduleId?: string | null; payType: 'monthly' | 'daily' | 'hourly'; rate: number;
  hireDate?: string | null; tin?: string | null; sssNo?: string | null; philhealthNo?: string | null; pagibigNo?: string | null;
  allowances: { code: string; label: string; amount: number; taxable?: boolean }[];
  exemptions: { withholdingTax?: boolean; sss?: boolean; philhealth?: boolean; pagibig?: boolean };
  active?: boolean;
}

export const emptyEmployee: EmployeeInput = { employeeNo: '', firstName: '', lastName: '', payType: 'daily', rate: 0, allowances: [], exemptions: {} };

export function EmployeeForm({ initial, onSubmit, submitLabel }: { initial: EmployeeInput; onSubmit: (e: EmployeeInput) => Promise<void>; submitLabel: string }) {
  const [f, setF] = useState<EmployeeInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const branches = useApi<{ id: string; name: string }[]>('/api/branches');
  const schedules = useApi<{ id: string; name: string }[]>('/api/schedules');
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setF({ ...f, [k]: v });
  const allowance = f.allowances[0];
  return (
    <form onSubmit={async (e) => { e.preventDefault(); try { setError(null); await onSubmit(f); } catch (err) { setError((err as Error).message); } }}>
      <div className="form-grid">
        <label className="field">Employee no.<input value={f.employeeNo} onChange={(e) => set('employeeNo', e.target.value)} required /></label>
        <label className="field">First name<input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} required /></label>
        <label className="field">Last name<input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} required /></label>
        <label className="field">Position<input value={f.position ?? ''} onChange={(e) => set('position', e.target.value)} /></label>
        <label className="field">Department<input value={f.department ?? ''} onChange={(e) => set('department', e.target.value)} /></label>
        <label className="field">Branch<select value={f.branchId ?? ''} onChange={(e) => set('branchId', e.target.value || null)}><option value="">—</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="field">Schedule<select value={f.scheduleId ?? ''} onChange={(e) => set('scheduleId', e.target.value || null)}><option value="">Default 09:00–18:00</option>{schedules.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="field">Pay type<select value={f.payType} onChange={(e) => set('payType', e.target.value as EmployeeInput['payType'])}><option value="daily">Daily rate</option><option value="monthly">Monthly salary</option><option value="hourly">Hourly rate</option></select></label>
        <label className="field">Rate (₱)<input type="number" step="0.01" min="0" value={f.rate} onChange={(e) => set('rate', Number(e.target.value))} required /></label>
        <label className="field">Hire date<input type="date" value={f.hireDate ?? ''} onChange={(e) => set('hireDate', e.target.value || null)} /></label>
        <label className="field">TIN<input value={f.tin ?? ''} onChange={(e) => set('tin', e.target.value)} /></label>
        <label className="field">SSS no.<input value={f.sssNo ?? ''} onChange={(e) => set('sssNo', e.target.value)} /></label>
        <label className="field">PhilHealth no.<input value={f.philhealthNo ?? ''} onChange={(e) => set('philhealthNo', e.target.value)} /></label>
        <label className="field">Pag-IBIG no.<input value={f.pagibigNo ?? ''} onChange={(e) => set('pagibigNo', e.target.value)} /></label>
        <label className="field">Allowance per cutoff (₱, non-taxable)<input type="number" min="0" value={allowance?.amount ?? 0} onChange={(e) => set('allowances', Number(e.target.value) > 0 ? [{ code: allowance?.code ?? 'allowance', label: allowance?.label ?? 'Allowance (de minimis)', amount: Number(e.target.value) }] : [])} /></label>
      </div>
      <div className="row" style={{ marginTop: '.75rem' }}>
        <span className="muted small">Exempt from:</span>
        {(['withholdingTax', 'sss', 'philhealth', 'pagibig'] as const).map((k) => (
          <label key={k} className="row small" style={{ gap: '.3rem' }}><input type="checkbox" checked={!!f.exemptions[k]} onChange={(e) => set('exemptions', { ...f.exemptions, [k]: e.target.checked })} />{{ withholdingTax: 'Withholding tax (MWE)', sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG' }[k]}</label>
        ))}
        {initial.employeeNo && <label className="row small" style={{ gap: '.3rem' }}><input type="checkbox" checked={f.active !== false} onChange={(e) => set('active', e.target.checked)} />Active</label>}
      </div>
      {error && <div className="error" style={{ marginTop: '.5rem' }}>{error}</div>}
      <div style={{ marginTop: '1rem' }}><button className="btn primary">{submitLabel}</button></div>
    </form>
  );
}
