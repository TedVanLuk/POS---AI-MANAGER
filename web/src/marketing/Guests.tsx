import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { Avatar } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ago, ConsentDot, pesoShort, SEGMENT_LABEL, SegmentBadge, Tags, TierBadge, type GuestSummary, type Segment } from './shared';

interface List { total: number; tags: string[]; customers: GuestSummary[] }

export default function Guests() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const segment = sp.get('segment') ?? '';
  const tag = sp.get('tag') ?? '';
  const sort = sp.get('sort') ?? 'spend';
  const url = `/api/crm/customers?sort=${sort}${segment ? `&segment=${segment}` : ''}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
  const list = useApi<List>(url);
  const [adding, setAdding] = useState(false);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  return (
    <>
      <div className="page-head">
        <h1>Guests</h1>
        <span className="badge">{list.data?.total ?? '…'}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add guest</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search name, mobile or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 240px' }} aria-label="Search guests" />
        <select value={segment} onChange={(e) => set('segment', e.target.value)} aria-label="Segment">
          <option value="">All segments</option>
          {(Object.keys(SEGMENT_LABEL) as Segment[]).map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
        </select>
        <select value={tag} onChange={(e) => set('tag', e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {list.data?.tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
          <option value="spend">Top spend (12 mo)</option><option value="recent">Most recent</option><option value="visits">Most visits</option><option value="points">Most points</option><option value="name">Name</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Guest</th><th>Segment</th><th>Tags</th><th className="num">Visits</th><th className="num">12-mo spend</th><th className="num">Avg</th><th>Last visit</th><th className="num">Points</th><th>Consent</th></tr></thead>
          <tbody>
            {list.data?.customers.map((g) => (
              <tr key={g.id} className="click" onClick={() => nav(`/admin/marketing/guests/${g.id}`)}>
                <td><div className="row" style={{ gap: '.55rem', flexWrap: 'nowrap' }}><Avatar name={g.name} /><div><Link to={`/admin/marketing/guests/${g.id}`} onClick={(e) => e.stopPropagation()}><b>{g.name}</b></Link> <TierBadge tier={g.tier} /><div className="small muted">{g.phoneDisplay}{g.daysToBirthday !== null && g.daysToBirthday <= 14 ? ` · 🎂 in ${g.daysToBirthday}d` : ''}</div></div></div></td>
                <td><SegmentBadge s={g.segment} />{g.overdue && <span className="badge warn" title="Twice their usual gap since the last visit">overdue</span>}</td>
                <td><Tags tags={g.tags} max={3} /></td>
                <td className="num">{g.visits}</td>
                <td className="num">{pesoShort(g.spend365)}</td>
                <td className="num">{pesoShort(g.avgSpend)}</td>
                <td className="small">{ago(g.daysSinceLastVisit)}</td>
                <td className="num">{g.pointsBalance.toLocaleString('en-PH')}</td>
                <td><ConsentDot ok={g.marketable.sms} label="SMS" /></td>
              </tr>
            ))}
            {list.data && !list.data.customers.length && <tr><td colSpan={9} className="muted">No guests match.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.data && list.data.total > 500 && <div className="small muted" style={{ marginTop: 8 }}>Showing the first 500 — narrow the search to see others.</div>}
      {adding && <AddGuest onClose={() => setAdding(false)} onDone={(id) => nav(`/admin/marketing/guests/${id}`)} />}
    </>
  );
}

export function AddGuest({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const settings = useApi<{ settings: { consentText: string }; business: string }>('/api/crm/settings');
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', email: '', birthday: '', consentSms: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ id: string }>('/api/crm/customers', { ...f, birthday: f.birthday || null, email: f.email || null, phone: f.phone || null });
      onDone(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add guest" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save guest'}</button></>}>
      <div className="form-grid">
        <label className="field">First name<input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} autoFocus /></label>
        <label className="field">Last name<input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></label>
        <label className="field">Mobile<input value={f.phone} inputMode="tel" placeholder="0917 123 4567" onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field">Email<input value={f.email} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field">Birthday (MM-DD)<input value={f.birthday} placeholder="07-24" maxLength={5} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></label>
      </div>
      <ConsentBox checked={f.consentSms} onChange={(v) => setF({ ...f, consentSms: v })} text={settings.data?.settings.consentText.replaceAll('{{business}}', settings.data.business) ?? ''} />
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

/** Never pre-ticked: the NPC does not accept pre-ticked boxes as consent. */
export function ConsentBox({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label className="consent-box">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><b>Guest agrees to marketing SMS</b><br /><span className="small muted">Read to the guest: “{text}”</span></span>
    </label>
  );
}
