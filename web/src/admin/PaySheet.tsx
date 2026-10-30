import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDateTime, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { ConfirmDialog, Modal, ReasonDialog } from '../components/Modal';
import { computeSheet, SHEET_RULES, type ComputedSheet, type SheetRow } from '../../../server/src/payroll/sheet';

type View = ComputedSheet & {
  id: string; company: string; periodStart: string; periodEnd: string; label: string; status: 'draft' | 'final'; cashReceived: number; notes: string | null;
  finalizedAt: string | null; finalizedByName: string | null; updatedAt: string; sheetOrder: string[]; sections: { name: string; sheet: string; ndPerDay: number }[];
};
type Row = ComputedSheet['sheets'][number]['sections'][number]['rows'][number];
type Edit = Partial<Pick<SheetRow, 'days' | 'dailyRate' | 'otHours' | 'ndHours' | 'deductions' | 'remarks'>>;
const n2 = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hrs = (n: number) => (n ? String(Math.round(n * 100) / 100) : '');

/** One weekly payroll, shown and filled in like the paper sheets, plus the summary page. */
export default function PaySheet() {
  const { id } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const sheet = useApi<View>(`/api/pay-sheets/${id}`);
  const v = sheet.data;
  const [tab, setTab] = useState<string>('');
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [dialog, setDialog] = useState<'final' | 'reopen' | 'delete' | null>(null);
  const admin = isAdmin(me?.role);
  const editable = admin && v?.status === 'draft';

  // Recompute live with the unsaved edits so totals follow every keystroke.
  const baseRows = useMemo(() => v?.sheets.flatMap((s) => s.sections.flatMap((x) => x.rows)) ?? [], [v]);
  const live = useMemo(() => {
    if (!v) return null;
    const rows = baseRows.map((r) => ({ ...r, ...edits[r.id] }));
    const days = Math.round((Date.parse(v.periodEnd) - Date.parse(v.periodStart)) / 86400000) + 1;
    return computeSheet(rows, { cashReceived: v.cashReceived, periodDays: days, sheetOrder: v.sheetOrder });
  }, [v, baseRows, edits]);
  const dirty = Object.keys(edits).length;
  const current = live?.sheets.find((s) => s.name === tab) ? tab : tab === 'summary' ? 'summary' : live?.sheets[0]?.name ?? 'summary';

  const put = async (body: unknown) => { const next = await api.put<View>(`/api/pay-sheets/${id}/rows`, body); sheet.setData(next); return next; };
  const set = (r: Row, f: keyof Edit, value: number | string | null) => {
    const base = baseRows.find((x) => x.id === r.id)!;
    const cur = { ...base, ...edits[r.id] };
    const e: Edit = { ...edits[r.id], [f]: value };
    // Night-diff hours follow the days worked (days × ND hours per day), like the paper sheet.
    if (f === 'days' && cur.ndPerDay > 0 && Math.abs(cur.ndHours - cur.days * cur.ndPerDay) < 0.01) e.ndHours = Math.round(Number(value) * cur.ndPerDay * 100) / 100;
    for (const k of Object.keys(e) as (keyof Edit)[]) if (e[k] === base[k]) delete e[k];
    const next = { ...edits };
    if (Object.keys(e).length) next[r.id] = e; else delete next[r.id];
    setEdits(next);
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await put({ changes: Object.entries(edits).map(([rid, e]) => ({ id: rid, ...e })), reason: reason.trim() || null }); setEdits({}); setReason(''); setMsg('Saved'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const togglePaid = async (r: Row) => {
    try { await put({ changes: [{ id: r.id, paid: !r.paid }] }); } catch (e) { setMsg((e as Error).message); }
  };

  if (sheet.error) return <div className="error">{sheet.error}</div>;
  if (!v || !live) return <div className="muted">Loading…</div>;
  const showOt = live.sheets.find((s) => s.name === current)?.sections.some((x) => x.rows.some((r) => r.otHours > 0)) || editable;

  return (
    <div className="paysheet">
      <div className="page-head">
        <Link to="/admin/payroll" className="round-nav" aria-label="Back to weekly payroll"><Icon name="left" /></Link>
        <div>
          <div className="ps-company">{v.company.toUpperCase()}</div>
          <h1>Payroll Period Covered: {v.label}</h1>
          <div className="muted small">
            {v.status === 'final' ? <span className="badge good">Final</span> : <span className="badge">Draft</span>}
            {v.finalizedByName && <> · marked final by {v.finalizedByName} {v.finalizedAt ? fmtDateTime(v.finalizedAt) : ''}</>}
            {v.notes && <> · {v.notes}</>}
          </div>
        </div>
        <div className="spacer" />
        {admin && v.status === 'draft' && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> Add row</button>}
        {admin && v.status === 'draft' && <button className="btn" onClick={() => setDialog('delete')}>Delete draft</button>}
        {admin && v.status === 'draft' && <button className="btn primary" disabled={dirty > 0} title={dirty ? 'Save your changes first' : undefined} onClick={() => setDialog('final')}>Mark final</button>}
        {admin && v.status === 'final' && <button className="btn" onClick={() => setDialog('reopen')}>Reopen to edit</button>}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{peso(live.summary.amount)}</div><div className="k">Total salary · {live.totals.people} people</div></div>
        <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{peso(live.summary.paid)}</div><div className="k">Paid out (partial)</div></div>
        <div className="tile"><div className="v" style={{ fontSize: '1.8rem', color: live.summary.balance > 0 ? 'var(--critical)' : undefined }}>{peso(live.summary.balance)}</div><div className="k">Balance still to pay</div></div>
        <div className="tile"><div className="v" style={{ fontSize: '1.8rem' }}>{live.warnings}</div><div className="k">{live.warnings === 1 ? 'Row to check' : 'Rows to check'} (marked ⚠)</div></div>
      </div>

      <div className="tabs" role="tablist" aria-label="Payroll sheets">
        {live.sheets.map((s) => <button key={s.name} role="tab" aria-selected={current === s.name} className={current === s.name ? 'active' : ''} onClick={() => setTab(s.name)}>{s.name}</button>)}
        <button role="tab" aria-selected={current === 'summary'} className={current === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Summary</button>
      </div>

      {current === 'summary'
        ? <Summary v={v} live={live} admin={admin} onSaved={(next) => sheet.setData(next)} />
        : live.sheets.filter((s) => s.name === current).map((s) => {
          let no = 0;
          return (
            <section key={s.name} className="card table-wrap ps-card">
              <table className="ps">
                <thead>
                  <tr className="grp"><th colSpan={5} /><>{showOt && <th colSpan={2} className="c">Overtime (25%)</th>}</><th colSpan={2} className="c">Night Diff. (10%)</th><th colSpan={4} /></tr>
                  <tr>
                    <th>No.</th><th>Employee name</th><th className="c">No. of days worked</th><th className="num">Daily rate</th><th className="num">Gross salary</th>
                    {showOt && <><th className="c">No. of hours</th><th className="num">Amount</th></>}
                    <th className="c">No. of hours</th><th className="num">Amount</th>
                    <th className="num">Advances / penalties</th><th className="num">Net pay</th><th className="c">Paid</th><th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sections.map((sec) => (
                    <SectionRows key={sec.name} name={s.sections.length > 1 || sec.name !== s.name ? sec.name : null} cols={showOt ? 13 : 11}>
                      {sec.rows.map((r) => {
                        no += 1;
                        const changed = !!edits[r.id];
                        const num = (f: 'days' | 'dailyRate' | 'otHours' | 'ndHours' | 'deductions', w: string, step = 1) => editable
                          ? <input className={`ps-in ${w}`} type="number" min={0} step={step} value={String(r[f])} aria-label={`${r.name} ${f}`}
                              onChange={(e) => set(r, f, e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))} />
                          : null;
                        return (
                          <tr key={r.id} className={`${changed ? 'changed' : ''} ${r.warnings.length ? 'warn' : ''}`}>
                            <td className="muted">{no}</td>
                            <td className="nm">
                              <button className="link-btn" onClick={() => setDetail(r)} title="Details and change history">{r.name}</button>
                              {r.warnings.length > 0 && <span className="warn-ico" title={r.warnings.join('\n')} aria-label={r.warnings.join('. ')}>⚠</span>}
                              {r.history.length > 0 && <span className="hist-dot" title={`${r.history.length} change${r.history.length > 1 ? 's' : ''}`} />}
                            </td>
                            <td className="c">{num('days', 'w-s', 0.5) ?? (r.fixedPay !== null && !r.days ? '' : r.days)}</td>
                            <td className="num">{r.fixedPay !== null ? <span title="Fixed pay for the period">{n2(r.fixedPay)}</span> : num('dailyRate', 'w-m') ?? n2(r.dailyRate)}</td>
                            <td className="num">{n2(r.gross)}</td>
                            {showOt && <><td className="c">{num('otHours', 'w-s', 0.5) ?? hrs(r.otHours)}</td><td className="num">{r.otAmount ? n2(r.otAmount) : ''}</td></>}
                            <td className="c">{num('ndHours', 'w-s', 0.5) ?? hrs(r.ndHours)}</td>
                            <td className="num">{r.ndAmount || r.ndHours ? n2(r.ndAmount) : ''}</td>
                            <td className="num" title={r.deductionNote ?? undefined}>{num('deductions', 'w-m') ?? (r.deductions ? n2(r.deductions) : '')}</td>
                            <td className={`num net ${r.paid ? 'paid' : ''}`}><b>{n2(r.net)}</b></td>
                            <td className="c"><input type="checkbox" checked={r.paid} disabled={changed} onChange={() => togglePaid(r)} aria-label={`${r.name} paid`} title={r.paid && r.paidBy ? `Paid · ${r.paidBy}${r.paidAt ? ` · ${fmtDateTime(r.paidAt)}` : ''}` : 'Mark as paid'} /></td>
                            <td className="rm">{editable ? <input className="ps-in w-l" value={r.remarks ?? ''} onChange={(e) => set(r, 'remarks', e.target.value || null)} aria-label={`${r.name} remarks`} /> : <span className="muted small">{r.remarks}</span>}</td>
                          </tr>
                        );
                      })}
                    </SectionRows>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td /><td><b>Total</b></td><td className="c">{s.totals.days}</td><td /><td className="num">{n2(s.totals.gross)}</td>
                    {showOt && <><td className="c">{hrs(s.totals.otHours)}</td><td className="num">{n2(s.totals.otAmount)}</td></>}
                    <td className="c">{hrs(s.totals.ndHours)}</td><td className="num">{n2(s.totals.ndAmount)}</td>
                    <td className="num">{n2(s.totals.deductions)}</td><td className="num"><b>{n2(s.totals.net)}</b></td><td /><td className="muted small">Paid {n2(s.totals.paid)} · Balance {n2(s.totals.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          );
        })}

      <p className="muted small">
        Gross = days × daily rate · OT = hours × (rate ÷ 8) × 125% · ND = hours × (rate ÷ 8) × 10%, with {SHEET_RULES.defaultNdHoursPerDay} ND hours per day by default · Net = gross + OT + ND − advances/penalties.
        Tick “Paid” as each person receives their salary; the net pay turns yellow like on the paper sheet.
      </p>

      {dirty > 0 && (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <b>{dirty} row{dirty > 1 ? 's' : ''} changed</b>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, saved with the change)" aria-label="Reason for the change" />
          <button className="btn" onClick={() => { setEdits({}); setReason(''); }}>Discard</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
      {msg && <div className="toast" role="status" onAnimationEnd={() => setMsg(null)}>{msg}</div>}

      {detail && <RowDetail row={detail} v={v} editable={editable} onClose={() => setDetail(null)} onSave={async (body) => { await put(body); setDetail(null); }} />}
      {adding && <AddRow v={v} defaultSheet={current === 'summary' ? live.sheets[0]?.name : current} onClose={() => setAdding(false)} onSave={async (body) => { await put(body); setAdding(false); }} />}
      {dialog === 'final' && <ConfirmDialog title="Mark this payroll final?" message="Amounts are locked. You can still tick who has been paid, change remarks and enter the cash received. Reopening later needs a reason." confirmLabel="Mark final"
        onClose={() => setDialog(null)} onConfirm={async () => sheet.setData(await api.patch<View>(`/api/pay-sheets/${id}`, { status: 'final' }))} />}
      {dialog === 'reopen' && <ReasonDialog title="Reopen payroll" description="The payroll goes back to draft so amounts can be changed." confirmLabel="Reopen"
        onClose={() => setDialog(null)} onConfirm={async (r) => sheet.setData(await api.patch<View>(`/api/pay-sheets/${id}`, { status: 'draft', reason: r }))} />}
      {dialog === 'delete' && <ConfirmDialog title="Delete this draft?" message={`The payroll for ${v.label} and its ${live.totals.people} rows will be deleted.`} confirmLabel="Delete" danger
        onClose={() => setDialog(null)} onConfirm={async () => { await api.del(`/api/pay-sheets/${id}`); nav('/admin/payroll'); }} />}
    </div>
  );
}

function SectionRows({ name, cols, children }: { name: string | null; cols: number; children: React.ReactNode }) {
  return <>{name && <tr className="sec"><td /><td colSpan={cols - 1}>{name.toUpperCase()}</td></tr>}{children}</>;
}

/** The last page of the paper payroll: amount, partial (paid) and balance per sheet, and the cash on hand. */
function Summary({ v, live, admin, onSaved }: { v: View; live: ComputedSheet; admin: boolean; onSaved: (v: View) => void }) {
  const [cash, setCash] = useState(String(v.cashReceived || ''));
  const [error, setError] = useState<string | null>(null);
  const s = live.summary;
  const saveCash = async () => {
    const n = Number(cash || 0);
    if (!Number.isFinite(n) || n < 0) { setError('Enter the cash received'); return; }
    try { setError(null); onSaved(await api.patch<View>(`/api/pay-sheets/${v.id}`, { cashReceived: n })); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="ps-summary">
      <section className="card table-wrap">
        <h2>{v.company.toUpperCase()} <span className="muted small">· Payroll Period Covered: {v.label}</span></h2>
        <table>
          <thead><tr><th>Sheet</th><th className="num">Amount</th><th className="num">Partial (paid)</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {s.rows.map((r) => <tr key={r.sheet}><td>{r.sheet}</td><td className="num">{n2(r.amount)}</td><td className="num">{n2(r.paid)}</td><td className="num">{n2(r.balance)}</td></tr>)}
          </tbody>
          <tfoot><tr><td><b>Total salary</b></td><td className="num"><b className="hl">{n2(s.amount)}</b></td><td className="num"><b>{n2(s.paid)}</b></td><td className="num"><b>{n2(s.balance)}</b></td></tr></tfoot>
        </table>
      </section>
      <section className="card">
        <h2>Cash</h2>
        <div className="cash-grid">
          <span>Cash received</span>
          {admin ? <span className="row" style={{ gap: '.4rem', justifyContent: 'flex-end' }}><input type="number" min={0} step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} style={{ width: 140, textAlign: 'right' }} aria-label="Cash received" /><button className="btn sm" disabled={Number(cash || 0) === v.cashReceived} onClick={saveCash}>Save</button></span> : <b className="num">{n2(s.cashReceived)}</b>}
          <span>Actual paid</span><b className="num">{n2(s.paid)}</b>
          <span>Remaining cash</span><b className={`num ${s.remaining < 0 ? 'bad-text' : ''}`}>{n2(s.remaining)}</b>
          <span className="big">Balance to fund</span><b className="num big hl">{n2(s.toFund)}</b>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>Balance to fund = salaries not yet paid ({n2(s.balance)}) − cash remaining ({n2(s.remaining)}).</p>
        {error && <div className="error">{error}</div>}
      </section>
    </div>
  );
}

function RowDetail({ row, v, editable, onClose, onSave }: { row: Row; v: View; editable: boolean; onClose: () => void; onSave: (body: unknown) => Promise<void> }) {
  const employees = useApi<{ id: string; firstName: string; lastName: string; department: string | null }[]>(editable ? '/api/employees' : null);
  const [f, setF] = useState({ name: row.name, employeeId: row.employeeId, section: `${row.sheet}|${row.section}`, fixed: row.fixedPay !== null, fixedPay: row.fixedPay ?? 0, ndPerDay: row.ndPerDay, deductionNote: row.deductionNote ?? '' });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const sections = sectionOptions(v, row);
  const save = async (body: unknown) => { try { setError(null); await onSave(body); } catch (e) { setError((e as Error).message); } };
  const [sheet, section] = f.section.split('|');
  return (
    <Modal title={row.name} onClose={onClose} actions={editable ? <>
      <button className="btn danger" onClick={() => setRemoving(true)}>Remove row</button>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => save({ reason: reason.trim() || null, changes: [{ id: row.id, name: f.name.trim(), employeeId: f.employeeId, sheet, section, fixedPay: f.fixed ? Number(f.fixedPay) : null, ndPerDay: Number(f.ndPerDay), deductionNote: f.deductionNote.trim() || null }] })}>Save</button>
    </> : <button className="btn" onClick={onClose}>Close</button>}>
      {editable ? (
        <div className="form-grid">
          <label className="field">Name on payroll<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Linked employee
            <select value={f.employeeId ?? ''} onChange={(e) => setF({ ...f, employeeId: e.target.value || null })}>
              <option value="">— Not linked —</option>
              {employees.data?.map((e) => <option key={e.id} value={e.id}>{`${e.firstName} ${e.lastName}`.trim()}{e.department ? ` · ${e.department}` : ''}</option>)}
            </select>
          </label>
          <label className="field">Sheet · section<select value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>{sections.map((o) => <option key={o} value={o}>{o.replace('|', ' · ')}</option>)}</select></label>
          <label className="field">ND hours per day<input type="number" min={0} max={12} step={0.5} value={f.ndPerDay} onChange={(e) => setF({ ...f, ndPerDay: Number(e.target.value) })} /></label>
          <label className="field"><span className="row" style={{ gap: '.35rem' }}><input type="checkbox" checked={f.fixed} onChange={(e) => setF({ ...f, fixed: e.target.checked })} />Fixed pay for the period</span>
            <input type="number" min={0} disabled={!f.fixed} value={f.fixedPay} onChange={(e) => setF({ ...f, fixedPay: Number(e.target.value) })} aria-label="Fixed pay" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>What the advances/penalties are for<input value={f.deductionNote} onChange={(e) => setF({ ...f, deductionNote: e.target.value })} placeholder="e.g. Cash advance 10/7; late 10/9" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Reason for this change (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>
      ) : (
        <dl className="kv">
          <dt>Section</dt><dd>{row.sheet} · {row.section}</dd>
          <dt>Daily rate</dt><dd>{row.fixedPay !== null ? `Fixed ${peso(row.fixedPay)}` : peso(row.dailyRate)}</dd>
          <dt>Advances / penalties</dt><dd>{peso(row.deductions)}{row.deductionNote ? ` — ${row.deductionNote}` : ''}</dd>
          <dt>Paid</dt><dd>{row.paid ? `Yes${row.paidBy ? ` · ${row.paidBy}` : ''}${row.paidAt ? ` · ${fmtDateTime(row.paidAt)}` : ''}` : 'Not yet'}</dd>
        </dl>
      )}
      {row.warnings.length > 0 && <div className="notice" style={{ marginTop: 12 }}>⚠ {row.warnings.join(' · ')}</div>}
      <h3 style={{ marginTop: 16 }}>Change history</h3>
      {row.history.length ? (
        <ul className="hist">
          {[...row.history].reverse().map((h, i) => (
            <li key={i}>
              <div><b>{h.byName}</b> <span className="muted small">{fmtDateTime(h.at)}</span></div>
              <div className="small">{h.changes.map((c) => c.field === 'row' ? 'Row added' : `${c.field}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`).join(' · ')}</div>
              {h.reason && <div className="muted small">Reason: {h.reason}</div>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">No changes since the payroll was created.</p>}
      {error && <div className="error">{error}</div>}
      {removing && <ConfirmDialog title={`Remove ${row.name}?`} message="The row is taken off this payroll. This is recorded in the audit log." confirmLabel="Remove" danger onClose={() => setRemoving(false)} onConfirm={() => onSave({ remove: [row.id], reason: reason.trim() || null })} />}
    </Modal>
  );
}
const fmtVal = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x));

function sectionOptions(v: View, row?: { sheet: string; section: string }) {
  const fromRows = v.sheets.flatMap((s) => s.sections.map((x) => `${s.name}|${x.name}`));
  const fromSettings = v.sections.map((x) => `${x.sheet}|${x.name}`);
  return [...new Set([...(row ? [`${row.sheet}|${row.section}`] : []), ...fromRows, ...fromSettings])];
}

function AddRow({ v, defaultSheet, onClose, onSave }: { v: View; defaultSheet?: string; onClose: () => void; onSave: (body: unknown) => Promise<void> }) {
  const employees = useApi<{ id: string; firstName: string; lastName: string; department: string | null; payType: string; rate: number }[]>('/api/employees');
  const options = sectionOptions(v);
  const [f, setF] = useState({ employeeId: '', name: '', section: options.find((o) => o.startsWith(`${defaultSheet}|`)) ?? options[0] ?? '', days: 0, dailyRate: 0, deductions: 0 });
  const [error, setError] = useState<string | null>(null);
  const pick = (empId: string) => {
    const e = employees.data?.find((x) => x.id === empId);
    if (!e) { setF({ ...f, employeeId: '' }); return; }
    const sec = options.find((o) => o.endsWith(`|${e.department}`));
    setF({ ...f, employeeId: e.id, name: `${e.firstName} ${e.lastName}`.trim(), section: sec ?? f.section, dailyRate: e.payType === 'daily' ? e.rate : e.payType === 'hourly' ? e.rate * 8 : f.dailyRate });
  };
  const [sheet, section] = f.section.split('|');
  const ndPerDay = v.sections.find((x) => x.name === section)?.ndPerDay ?? SHEET_RULES.defaultNdHoursPerDay;
  return (
    <Modal title="Add a row" onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!f.name.trim() || !f.section} onClick={async () => {
        try { setError(null); await onSave({ changes: [{ employeeId: f.employeeId || null, name: f.name.trim(), sheet, section, days: f.days, dailyRate: f.dailyRate, deductions: f.deductions, ndPerDay, ndHours: f.days * ndPerDay }] }); } catch (e) { setError((e as Error).message); }
      }}>Add</button>
    </>}>
      <div className="form-grid">
        <label className="field">Employee<select value={f.employeeId} onChange={(e) => pick(e.target.value)}><option value="">— Not on the Employees List —</option>{employees.data?.map((e) => <option key={e.id} value={e.id}>{`${e.firstName} ${e.lastName}`.trim()}{e.department ? ` · ${e.department}` : ''}</option>)}</select></label>
        <label className="field">Name on payroll<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Sheet · section<select value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>{options.map((o) => <option key={o} value={o}>{o.replace('|', ' · ')}</option>)}</select></label>
        <label className="field">Days worked<input type="number" min={0} step={0.5} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} /></label>
        <label className="field">Daily rate (₱)<input type="number" min={0} value={f.dailyRate} onChange={(e) => setF({ ...f, dailyRate: Number(e.target.value) })} /></label>
        <label className="field">Advances / penalties (₱)<input type="number" min={0} value={f.deductions} onChange={(e) => setF({ ...f, deductions: Number(e.target.value) })} /></label>
      </div>
      <p className="muted small">Night differential: {ndPerDay} hours per day worked for this section.</p>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}
