import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso } from '../api';
import { useApi } from '../hooks';
import { Avatar, Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ConsentBox } from './Guests';
import { pesoShort, TierBadge, Tags, type GuestSummary } from './shared';

type Status = 'requested' | 'confirmed' | 'arrived' | 'completed' | 'no_show' | 'cancelled';
interface Res {
  id: string; customerId: string; date: string; arrivalTime: string | null; partySize: number; tableArea: string | null; minSpend: number; deposit: number; status: Status;
  hostEmployeeId: string | null; promoterEmployeeId: string | null; notes: string | null; actualSpend: number | null; guest: GuestSummary; recognition: string;
  preferences: Record<string, string>; hostName: string | null; promoterName: string | null;
}
interface Day { date: string; today: string; reservations: Res[]; totals: { bookings: number; guests: number; minSpend: number; arrived: number; noShows: number } }
interface Emp { id: string; firstName: string; lastName: string; department: string | null; active: boolean }
interface Attribution { from: string; to: string; people: { employeeId: string; name: string; role: 'promoter' | 'host'; bookings: number; guests: number; arrived: number; noShows: number; spend: number; minSpend: number; newGuests: number }[] }

const STATUS_LABEL: Record<Status, string> = { requested: 'Requested', confirmed: 'Confirmed', arrived: 'Arrived', completed: 'Closed', no_show: 'No-show', cancelled: 'Cancelled' };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function Tonight() {
  const [date, setDate] = useState<string | null>(null);
  const day = useApi<Day>(`/api/crm/reservations${date ? `?date=${date}` : ''}`);
  const attr = useApi<Attribution>('/api/crm/attribution');
  const settings = useApi<{ tables: { area: string; consumable: string }[]; settings: { consentText: string; categories: string[] }; business: string }>('/api/crm/settings');
  const emps = useApi<Emp[]>('/api/employees');
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<Res | null>(null);
  const d = day.data;
  const cur = date ?? d?.today ?? '';
  const setStatus = async (r: Res, status: Status) => { await api.patch(`/api/crm/reservations/${r.id}`, { status }); await day.reload(); };
  const active = d?.reservations.filter((r) => r.status !== 'cancelled') ?? [];
  const order: Status[] = ['arrived', 'confirmed', 'requested', 'completed', 'no_show', 'cancelled'];
  const list = [...(d?.reservations ?? [])].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.arrivalTime ?? '').localeCompare(b.arrivalTime ?? ''));
  const label = cur === d?.today ? 'Tonight' : new Date(`${cur}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <>
      <div className="page-head">
        <h1>{label}</h1>
        <div className="date-nav">
          <button className="icon-btn" aria-label="Previous night" onClick={() => setDate(addDays(cur, -1))}><Icon name="left" /></button>
          <input type="date" value={cur} onChange={(e) => setDate(e.target.value || null)} aria-label="Date" />
          <button className="icon-btn" aria-label="Next night" onClick={() => setDate(addDays(cur, 1))}><Icon name="right" /></button>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>+ Reservation</button>
      </div>

      {d && (
        <div className="d-tiles mk-tiles">
          <div className="tile"><div className="v">{d.totals.bookings}</div><div className="k">Tables booked · {d.totals.guests} guests</div></div>
          <div className="tile"><div className="v">{pesoShort(d.totals.minSpend)}</div><div className="k">Minimum consumable on the book</div></div>
          <div className="tile"><div className="v">{d.totals.arrived}/{d.totals.bookings}</div><div className="k">Arrived</div></div>
          <div className="tile"><div className="v">{active.filter((r) => r.guest.tags.includes('VIP') || (r.guest.tier && r.guest.tier !== 'Member')).length}</div><div className="k">VIP / tier guests expected</div></div>
          <div className="tile"><div className="v">{d.totals.noShows}</div><div className="k">No-shows</div></div>
        </div>
      )}

      <div className="res-list">
        {list.map((r) => (
          <div key={r.id} className={`card res-card st-${r.status}`}>
            <div className="res-time"><b>{r.arrivalTime ?? '—'}</b><span>{r.partySize} pax</span></div>
            <div className="res-main">
              <div className="row" style={{ gap: '.5rem' }}>
                <Avatar name={r.guest.name} />
                <Link to={`/admin/marketing/guests/${r.customerId}`}><b>{r.guest.name}</b></Link>
                <TierBadge tier={r.guest.tier} /><Tags tags={r.guest.tags.filter((t) => ['VIP', 'Big spender', 'Celebrity', 'No-show risk', 'Birthday soon'].includes(t))} />
              </div>
              <div className="recog small"><Icon name="spark" />{r.recognition}</div>
              <div className="small muted">{r.tableArea ?? 'No table'} · min. {peso(r.minSpend)}{r.deposit ? ` · deposit ${peso(r.deposit)}` : ''}{r.hostName ? ` · host ${r.hostName}` : ''}{r.promoterName ? ` · via ${r.promoterName}` : ''}</div>
              {r.notes && <div className="small res-note">📝 {r.notes}</div>}
              {r.status === 'completed' && r.actualSpend !== null && <div className="small">Spent <b>{peso(r.actualSpend)}</b> {r.minSpend ? <span className={r.actualSpend >= r.minSpend ? 'good-text' : 'bad-text'}>({Math.round((r.actualSpend / r.minSpend) * 100)}% of minimum)</span> : null}</div>}
            </div>
            <div className="res-actions">
              <span className={`badge ${r.status === 'arrived' ? 'good' : r.status === 'no_show' ? 'bad' : r.status === 'requested' ? 'warn' : ''}`}>{STATUS_LABEL[r.status]}</span>
              {r.status === 'requested' && <button className="btn sm" onClick={() => setStatus(r, 'confirmed')}>Confirm</button>}
              {(r.status === 'confirmed' || r.status === 'requested') && <><button className="btn sm primary" onClick={() => setStatus(r, 'arrived')}>Arrived</button><button className="btn sm" onClick={() => setStatus(r, 'no_show')}>No-show</button><button className="btn sm" onClick={() => setStatus(r, 'cancelled')}>Cancel</button></>}
              {r.status === 'arrived' && <button className="btn sm primary" onClick={() => setClosing(r)}>Close table…</button>}
              {(r.status === 'no_show' || r.status === 'cancelled') && <button className="btn sm" onClick={() => setStatus(r, 'confirmed')}>Undo</button>}
            </div>
          </div>
        ))}
        {d && !list.length && <div className="card muted">No reservations for this night.</div>}
      </div>

      {attr.data && attr.data.people.length > 0 && (
        <div className="card table-wrap" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Who brings the guests</h2><div className="spacer" /><span className="small">{attr.data.from} → {attr.data.to} · feeds table commissions in Payroll</span></div>
          <table><thead><tr><th>Name</th><th>Role</th><th className="num">Bookings</th><th className="num">Guests</th><th className="num">Show-up</th><th className="num">New guests</th><th className="num">Table spend</th><th className="num">vs minimum</th></tr></thead>
            <tbody>{attr.data.people.map((x) => (
              <tr key={`${x.role}${x.employeeId}`}><td><Link to={`/admin/employees/${x.employeeId}`}>{x.name}</Link></td><td>{x.role === 'host' ? 'VIP host' : 'Promoter'}</td><td className="num">{x.bookings}</td><td className="num">{x.guests}</td>
                <td className="num">{x.bookings ? Math.round((x.arrived / x.bookings) * 100) : 0}%</td><td className="num">{x.role === 'promoter' ? x.newGuests : '—'}</td><td className="num">{pesoShort(x.spend)}</td><td className="num">{x.minSpend ? `${Math.round((x.spend / x.minSpend) * 100)}%` : '—'}</td></tr>
            ))}</tbody></table>
        </div>
      )}

      {adding && settings.data && <NewReservation date={cur} tables={settings.data.tables} consentText={settings.data.settings.consentText.replaceAll('{{business}}', settings.data.business)} emps={emps.data ?? []} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await day.reload(); }} />}
      {closing && settings.data && <CloseTable r={closing} categories={settings.data.settings.categories} onClose={() => setClosing(null)} onSaved={async () => { setClosing(null); await day.reload(); await attr.reload(); }} />}
    </>
  );
}

function NewReservation({ date, tables, emps, consentText, onClose, onSaved }: { date: string; tables: { area: string; consumable: string }[]; emps: Emp[]; consentText: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ phone: '', firstName: '', lastName: '', date, arrivalTime: '22:00', partySize: 4, tableArea: '', minSpend: 0, deposit: 0, hostEmployeeId: '', promoterEmployeeId: '', notes: '', consentSms: false });
  const [err, setErr] = useState<string | null>(null);
  const [look, setLook] = useState<{ found: boolean; profile?: GuestSummary; recognition?: string } | null>(null);
  const hosts = emps.filter((e) => e.active && e.department === 'VIP Host');
  const promoters = emps.filter((e) => e.active && e.department === 'Promoters');
  const lookup = async (phone: string) => { if (phone.replace(/\D/g, '').length >= 10) setLook(await api.get(`/api/crm/lookup?phone=${encodeURIComponent(phone)}`)); else setLook(null); };
  const save = async () => {
    try {
      await api.post('/api/crm/reservations', { ...f, hostEmployeeId: f.hostEmployeeId || null, promoterEmployeeId: f.promoterEmployeeId || null, tableArea: f.tableArea || null, notes: f.notes || null, firstName: f.firstName || undefined, lastName: f.lastName || undefined });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="New reservation" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Book</button></>}>
      <div className="form-grid">
        <label className="field">Guest mobile<input value={f.phone} inputMode="tel" placeholder="0917 123 4567" onChange={(e) => { setF({ ...f, phone: e.target.value }); void lookup(e.target.value); }} autoFocus /></label>
        {look?.found ? <div className="recog small" style={{ alignSelf: 'end' }}><b>{look.profile?.name}</b> · {look.recognition}</div> : <>
          <label className="field">First name<input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></label>
          <label className="field">Last name<input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></label></>}
        <label className="field">Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field">Arrival<input type="time" value={f.arrivalTime} onChange={(e) => setF({ ...f, arrivalTime: e.target.value })} /></label>
        <label className="field">Party size<input type="number" min={1} value={f.partySize} onChange={(e) => setF({ ...f, partySize: Number(e.target.value) })} /></label>
        <label className="field">Table<select value={f.tableArea} onChange={(e) => { const t = tables.find((x) => x.area === e.target.value); setF({ ...f, tableArea: e.target.value, minSpend: Number((t?.consumable ?? '').replace(/[^\d]/g, '')) || 0 }); }}>
          <option value="">—</option>{tables.map((t) => <option key={t.area} value={t.area}>{t.area} · {t.consumable}</option>)}</select></label>
        <label className="field">Minimum consumable (₱)<input type="number" min={0} value={f.minSpend} onChange={(e) => setF({ ...f, minSpend: Number(e.target.value) })} /></label>
        <label className="field">Deposit (₱)<input type="number" min={0} value={f.deposit} onChange={(e) => setF({ ...f, deposit: Number(e.target.value) })} /></label>
        <label className="field">VIP host<select value={f.hostEmployeeId} onChange={(e) => setF({ ...f, hostEmployeeId: e.target.value })}><option value="">—</option>{hosts.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label>
        <label className="field">Promoter<select value={f.promoterEmployeeId} onChange={(e) => setF({ ...f, promoterEmployeeId: e.target.value })}><option value="">—</option>{promoters.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label>
      </div>
      <label className="field" style={{ marginTop: 8 }}>Notes (birthday, bottle on arrival…)<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      {!look?.found && <ConsentBox checked={f.consentSms} onChange={(v) => setF({ ...f, consentSms: v })} text={consentText} />}
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function CloseTable({ r, categories, onClose, onSaved }: { r: Res; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [spend, setSpend] = useState('');
  const [cats, setCats] = useState<string[]>(['table']);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(spend);
  return (
    <Modal title={`Close table · ${r.guest.name}`} onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!(n > 0)} onClick={async () => { try { await api.patch(`/api/crm/reservations/${r.id}`, { status: 'completed', actualSpend: n, categories: cats }); onSaved(); } catch (e) { setErr((e as Error).message); } }}>Close & add to profile</button></>}>
      <label className="field">Final bill (₱)<input type="number" min={0} value={spend} onChange={(e) => setSpend(e.target.value)} autoFocus /></label>
      {r.minSpend > 0 && n > 0 && <div className={`small ${n >= r.minSpend ? 'good-text' : 'bad-text'}`}>{n >= r.minSpend ? `Above minimum by ${peso(n - r.minSpend)}` : `Below the ${peso(r.minSpend)} minimum by ${peso(r.minSpend - n)}`}</div>}
      <div className="chip-pick" style={{ marginTop: 10 }}>{categories.map((c) => <button type="button" key={c} className={cats.includes(c) ? 'on' : ''} onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])}>{c}</button>)}</div>
      <div className="small muted" style={{ marginTop: 8 }}>The bill is added to the guest's history and earns loyalty points.</div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}
