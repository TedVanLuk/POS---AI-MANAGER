import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks';
import { AddGuest } from '../marketing/Guests';
import { SEGMENT_LABEL, type GuestSummary, type Segment } from '../marketing/shared';
import { fmtK } from './charts';

interface List { total: number; tags: string[]; customers: GuestSummary[] }
type Col = 'name' | 'tier' | 'segment' | 'visits' | 'spend365' | 'spend' | 'avgSpend' | 'lastVisit' | 'pointsBalance';
const PAGE = 50;

/** The customer database: every customer, every number, filterable and sortable. */
export default function Customers() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const list = useApi<List>('/api/crm/customers?sort=spend&limit=10000');
  const settings = useApi<{ settings: { tiers: { name: string }[] } }>('/api/crm/settings');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'spend365', dir: -1 });
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const f = { segment: sp.get('segment') ?? '', tier: sp.get('tier') ?? '', tag: sp.get('tag') ?? '', consent: sp.get('consent') ?? '', active: sp.get('active') ?? '', min: sp.get('min') ?? '' };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(0); };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase(); const digits = s.replace(/\D/g, '');
    const out = (list.data?.customers ?? []).filter((c) =>
      (!s || c.name.toLowerCase().includes(s) || (c.email ?? '').toLowerCase().includes(s) || (digits.length >= 3 && c.phoneDisplay.replace(/\D/g, '').includes(digits)))
      && (!f.segment || c.segment === f.segment) && (!f.tier || c.tier === f.tier) && (!f.tag || c.tags.includes(f.tag))
      && (!f.consent || (f.consent === 'yes' ? c.marketable.sms : !c.marketable.sms))
      && (!f.active || (c.daysSinceLastVisit !== null && (f.active === 'lapsed' ? c.daysSinceLastVisit > 60 : c.daysSinceLastVisit <= Number(f.active))))
      && (!f.min || c.spend365 >= Number(f.min)));
    const v = (c: GuestSummary) => (sort.col === 'lastVisit' ? c.lastVisit ?? '' : sort.col === 'name' || sort.col === 'tier' || sort.col === 'segment' ? String(c[sort.col] ?? '') : (c[sort.col] as number));
    return out.sort((a, b) => { const x = v(a), y = v(b); return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir; });
  }, [list.data, q, f.segment, f.tier, f.tag, f.consent, f.active, f.min, sort]);

  const totals = rows.reduce((a, c) => ({ spend: a.spend + c.spend365, visits: a.visits + c.visits, sms: a.sms + (c.marketable.sms ? 1 : 0) }), { spend: 0, visits: 0, sms: 0 });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const th = (col: Col, label: string, num?: boolean) => (
    <th className={`${num ? 'num' : ''} sortable ${sort.col === col ? 'on' : ''}`} aria-sort={sort.col === col ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((x) => ({ col, dir: x.col === col ? (x.dir === 1 ? -1 : 1) : col === 'name' ? 1 : -1 }))}>{label}{sort.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );
  const copyCsv = async () => {
    const head = ['Name', 'Mobile', 'Email', 'Tier', 'Segment', 'Visits', 'Spend 12 mo', 'Lifetime', 'Avg ticket', 'Last visit', 'Points', 'SMS consent', 'Tags'];
    const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const csv = [head, ...rows.map((c) => [c.name, c.phoneDisplay, c.email, c.tier, SEGMENT_LABEL[c.segment], c.visits, c.spend365, c.spend, c.avgSpend, c.lastVisit, c.pointsBalance, c.marketable.sms ? 'yes' : 'no', c.tags.join('; ')])].map((r) => r.map(esc).join(',')).join('\n');
    try { await navigator.clipboard.writeText(csv); setCopied(`${rows.length} rows copied — paste into a spreadsheet`); } catch { setCopied('Copy was blocked by the browser'); }
    setTimeout(() => setCopied(null), 3500);
  };

  return (
    <div className="cx-page">
      <div className="cx-title">
        <div><h1>Customer database</h1><p>{list.data ? `${rows.length} of ${list.data.total} customers` : 'Loading…'}</p></div>
        <div className="cx-actions">{copied && <span className="cx-muted">{copied}</span>}<button className="cx-btn" onClick={copyCsv}>Copy as CSV</button><button className="cx-btn gold" onClick={() => setAdding(true)}>+ Add customer</button></div>
      </div>

      <div className="cx-filters">
        <input className="grow" placeholder="Search name, mobile or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search customers" />
        <select value={f.segment} onChange={(e) => set('segment', e.target.value)} aria-label="Segment"><option value="">All segments</option>{(Object.keys(SEGMENT_LABEL) as Segment[]).map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select>
        <select value={f.tier} onChange={(e) => set('tier', e.target.value)} aria-label="Tier"><option value="">All tiers</option>{settings.data?.settings.tiers.map((t) => <option key={t.name}>{t.name}</option>)}</select>
        <select value={f.tag} onChange={(e) => set('tag', e.target.value)} aria-label="Tag"><option value="">All tags</option>{list.data?.tags.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={f.active} onChange={(e) => set('active', e.target.value)} aria-label="Last visit"><option value="">Any last visit</option><option value="7">Within 7 days</option><option value="30">Within 30 days</option><option value="90">Within 90 days</option><option value="lapsed">Not in 60+ days</option></select>
        <select value={f.min} onChange={(e) => set('min', e.target.value)} aria-label="Minimum spend"><option value="">Any spend</option><option value="10000">₱10k+ / 12 mo</option><option value="50000">₱50k+ / 12 mo</option><option value="100000">₱100k+ / 12 mo</option><option value="250000">₱250k+ / 12 mo</option></select>
        <select value={f.consent} onChange={(e) => set('consent', e.target.value)} aria-label="SMS consent"><option value="">Any consent</option><option value="yes">Can be messaged</option><option value="no">No SMS consent</option></select>
      </div>

      <div className="cx-sumbar"><span><b>{rows.length}</b> customers</span><span><b>{fmtK(totals.spend)}</b> spent in 12 months</span><span><b>{rows.length ? fmtK(totals.spend / rows.length) : '—'}</b> per customer</span><span><b>{totals.visits}</b> visits</span><span><b>{rows.length ? Math.round((totals.sms / rows.length) * 100) : 0}%</b> can be messaged</span></div>

      <div className="cx-panel flush"><div className="cx-scroll">
        <table className="cx-table db">
          <thead><tr>{th('name', 'Customer')}{th('tier', 'Tier')}{th('segment', 'Segment')}<th>Tags</th>{th('visits', 'Visits', true)}{th('spend365', '12 mo', true)}{th('spend', 'Lifetime', true)}{th('avgSpend', 'Ticket', true)}{th('lastVisit', 'Last visit')}{th('pointsBalance', 'Points', true)}<th>SMS</th></tr></thead>
          <tbody>
            {rows.slice(page * PAGE, page * PAGE + PAGE).map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/crm/customers/${c.id}`)}>
                <td><Link to={`/crm/customers/${c.id}`} onClick={(e) => e.stopPropagation()}><b>{c.name}</b></Link><span className="sub">{c.phoneDisplay}{c.daysToBirthday !== null && c.daysToBirthday <= 14 ? ` · birthday in ${c.daysToBirthday}d` : ''}</span></td>
                <td><span className={`cx-tier t-${(c.tier ?? '').toLowerCase().replace(/\W+/g, '')}`}>{c.tier}</span></td>
                <td>{SEGMENT_LABEL[c.segment]}{c.overdue && <span className="cx-flag">overdue</span>}</td>
                <td className="tags">{c.tags.slice(0, 3).map((t) => <span key={t} className={`cx-tag ${t === 'VIP' ? 'vip' : ''}`}>{t}</span>)}{c.tags.length > 3 && <span className="cx-tag">+{c.tags.length - 3}</span>}</td>
                <td className="num">{c.visits}</td>
                <td className="num gold">{fmtK(c.spend365)}</td>
                <td className="num">{fmtK(c.spend)}</td>
                <td className="num">{fmtK(c.avgSpend)}</td>
                <td>{c.daysSinceLastVisit === null ? '—' : c.daysSinceLastVisit === 0 ? 'today' : `${c.daysSinceLastVisit}d ago`}</td>
                <td className="num">{c.pointsBalance.toLocaleString('en-PH')}</td>
                <td><span className={`cx-dot ${c.marketable.sms ? 'on' : ''}`} title={c.marketable.sms ? 'Opted in to SMS' : 'No marketing consent'} /></td>
              </tr>
            ))}
            {list.data && !rows.length && <tr><td colSpan={11} className="cx-muted">No customers match these filters.</td></tr>}
          </tbody>
        </table>
      </div></div>
      {pages > 1 && <div className="cx-pager"><button className="cx-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button><span>Page {page + 1} of {pages}</span><button className="cx-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button></div>}
      {adding && <AddGuest onClose={() => setAdding(false)} onDone={(id) => nav(`/crm/customers/${id}`)} />}
    </div>
  );
}
