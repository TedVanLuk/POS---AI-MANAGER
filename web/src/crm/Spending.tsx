import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks';
import { SEGMENT_LABEL, type Segment } from '../marketing/shared';
import { Bars, Delta, fmtK, HBars, HeatGrid, Panel, Pareto, Scatter, Stat } from './charts';

export interface SpendingData {
  from: string; to: string; days: number;
  kpis: { revenue: number; prevRevenue: number; customers: number; prevCustomers: number; visits: number; prevVisits: number; avgPerCustomer: number; avgTicket: number; prevAvgTicket: number; visitsPerCustomer: number; top10Share: number; top20Share: number; retained: number; lost: number; gained: number };
  pareto: { customersPct: number; revenuePct: number }[];
  histogram: { label: string; customers: number; revenue: number }[];
  byTier: { name: string; customers: number; revenue: number; avgPerCustomer: number; avgTicket: number; share: number }[];
  bySegment: { name: string; customers: number; revenue: number; avgPerCustomer: number; avgTicket: number; share: number }[];
  categories: { name: string; visitsPct: number; revenueWith: number; avgTicketWith: number }[];
  heat: { hours: number[]; rows: number[][]; max: number };
  series: { date: string; revenue: number; visits: number; customers: number }[];
  growers: { id: string; name: string; tier: string | null; now: number; before: number; delta: number }[];
  decliners: { id: string; name: string; tier: string | null; now: number; before: number; delta: number }[];
  scatter: { id: string; name: string; tier: string | null; visits: number; avgTicket: number; spend: number }[];
  leaderboard: { id: string; name: string; tier: string | null; segment: Segment; tags: string[]; visits: number; spend: number; avgTicket: number; share: number; before: number; lifetime: number; lastVisit: string | null }[];
}

const PERIODS = [30, 90, 180, 365];
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

export default function Spending() {
  const [days, setDays] = useState(90);
  const [tier, setTier] = useState('');
  const [segment, setSegment] = useState('');
  const d = useApi<SpendingData>(`/api/crm/spending?days=${days}${tier ? `&tier=${encodeURIComponent(tier)}` : ''}${segment ? `&segment=${segment}` : ''}`);
  const tiers = useApi<{ settings: { tiers: { name: string }[] } }>('/api/crm/settings');
  const nav = useNavigate();
  const s = d.data;
  const k = s?.kpis;
  return (
    <div className="cx-page">
      <div className="cx-title">
        <div><h1>Spending performance</h1><p>{s ? `${day(s.from)} – ${day(s.to)}, compared with the ${days} days before` : 'Loading…'}</p></div>
        <div className="cx-actions">
          <div className="cx-seg" role="group" aria-label="Period">{PERIODS.map((p) => <button key={p} className={p === days ? 'on' : ''} onClick={() => setDays(p)}>{p === 365 ? '12 mo' : `${p} d`}</button>)}</div>
          <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier"><option value="">All tiers</option>{tiers.data?.settings.tiers.map((t) => <option key={t.name}>{t.name}</option>)}</select>
          <select value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="Segment"><option value="">All segments</option>{(Object.keys(SEGMENT_LABEL) as Segment[]).map((x) => <option key={x} value={x}>{SEGMENT_LABEL[x]}</option>)}</select>
        </div>
      </div>
      {d.error && <div className="error">{d.error}</div>}
      {!s || !k ? <div className="cx-loading">Calculating…</div> : <>
        <div className="cx-stats">
          <Stat label="Revenue" value={fmtK(k.revenue)} sub={<Delta now={k.revenue} before={k.prevRevenue} />} />
          <Stat label="Spending customers" value={k.customers} sub={<Delta now={k.customers} before={k.prevCustomers} />} />
          <Stat label="Spend per customer" value={fmtK(k.avgPerCustomer)} sub={`${k.visitsPerCustomer.toFixed(1)} visits each`} />
          <Stat label="Average ticket" value={fmtK(k.avgTicket)} sub={<Delta now={k.avgTicket} before={k.prevAvgTicket} />} />
          <Stat label="Top 10% of customers" value={`${k.top10Share}%`} sub="of revenue" />
          <Stat label="Kept / lost" value={`${k.retained} / ${k.lost}`} sub={`${k.gained} new spenders`} />
        </div>

        <Panel title="Revenue over time" sub={days > 120 ? 'weekly' : 'daily'}>
          <Bars label="Hover a bar" height={180} data={s.series.map((x) => ({ key: x.date, label: day(x.date), value: x.revenue }))} />
        </Panel>

        <div className="cx-grid g-3">
          <Panel title="Concentration" sub={`top 20% = ${k.top20Share}% of revenue`}>
            <Pareto points={s.pareto} />
            <p className="cx-note">{k.top20Share >= 70 ? 'A few big spenders carry the venue: protect them with VIP care and win-back alerts.' : k.top20Share >= 50 ? 'Revenue is moderately concentrated: grow the middle with tier perks.' : 'Revenue is spread widely: frequency (more visits) is the main lever.'}</p>
          </Panel>
          <Panel title="Spend per customer" sub="how many customers in each band">
            <HBars fmt={(n) => String(n)} rows={s.histogram.filter((h) => h.customers).map((h) => ({ label: h.label, value: h.customers, note: fmtK(h.revenue) }))} />
          </Panel>
          <Panel title="When they spend" sub="night × hour">
            <HeatGrid heat={s.heat} />
          </Panel>
        </div>

        <div className="cx-grid g-2">
          <Panel title="By tier">
            <table className="cx-table"><thead><tr><th>Tier</th><th className="num">Customers</th><th className="num">Revenue</th><th className="num">Share</th><th className="num">Per customer</th><th className="num">Ticket</th></tr></thead>
              <tbody>{s.byTier.map((t) => <tr key={t.name} className="click" onClick={() => setTier(t.name === '—' ? '' : t.name)}><td><b>{t.name}</b></td><td className="num">{t.customers}</td><td className="num">{fmtK(t.revenue)}</td><td className="num"><span className="cx-share"><i style={{ width: `${t.share}%` }} />{t.share}%</span></td><td className="num">{fmtK(t.avgPerCustomer)}</td><td className="num">{fmtK(t.avgTicket)}</td></tr>)}</tbody></table>
          </Panel>
          <Panel title="By segment">
            <table className="cx-table"><thead><tr><th>Segment</th><th className="num">Customers</th><th className="num">Revenue</th><th className="num">Share</th><th className="num">Per customer</th></tr></thead>
              <tbody>{s.bySegment.map((t) => <tr key={t.name}><td><b>{t.name}</b></td><td className="num">{t.customers}</td><td className="num">{fmtK(t.revenue)}</td><td className="num"><span className="cx-share"><i style={{ width: `${t.share}%` }} />{t.share}%</span></td><td className="num">{fmtK(t.avgPerCustomer)}</td></tr>)}</tbody></table>
          </Panel>
        </div>

        <div className="cx-grid g-2">
          <Panel title="Frequency × ticket" sub="click a dot to open the customer">
            <Scatter points={s.scatter} onPick={(id) => nav(`/crm/customers/${id}`)} />
          </Panel>
          <Panel title="What they buy" sub="share of visits that included it · average ticket on those visits">
            <HBars fmt={(n) => `${n}%`} rows={s.categories.map((c) => ({ label: c.name, value: c.visitsPct, note: `ticket ${fmtK(c.avgTicketWith)}` }))} />
          </Panel>
        </div>

        <div className="cx-grid g-2">
          <Panel title="Spending more" sub={`vs the previous ${days} days`}>
            <ol className="cx-rank">{s.growers.map((g) => <li key={g.id}><Link to={`/crm/customers/${g.id}`}><b>{g.name}</b><span>{g.tier} · {fmtK(g.before)} → {fmtK(g.now)}</span></Link><em className="up">+{fmtK(g.delta)}</em></li>)}</ol>
          </Panel>
          <Panel title="Spending less" sub="call or message before they are gone">
            <ol className="cx-rank warn">{s.decliners.map((g) => <li key={g.id}><Link to={`/crm/customers/${g.id}`}><b>{g.name}</b><span>{g.tier} · {fmtK(g.before)} → {fmtK(g.now)}</span></Link><em className="down">{fmtK(g.delta)}</em></li>)}</ol>
          </Panel>
        </div>

        <Panel title="Leaderboard" sub={`top 25 by spend in the period`}>
          <div className="cx-scroll"><table className="cx-table">
            <thead><tr><th>#</th><th>Customer</th><th>Tier</th><th>Segment</th><th className="num">Visits</th><th className="num">Spend</th><th className="num">Share</th><th className="num">Ticket</th><th className="num">vs before</th><th className="num">Lifetime</th><th>Last visit</th></tr></thead>
            <tbody>{s.leaderboard.map((r, i) => (
              <tr key={r.id} className="click" onClick={() => nav(`/crm/customers/${r.id}`)}>
                <td className="num">{i + 1}</td><td><b>{r.name}</b></td><td>{r.tier}</td><td>{SEGMENT_LABEL[r.segment]}</td><td className="num">{r.visits}</td><td className="num gold">{fmtK(r.spend)}</td><td className="num">{r.share}%</td><td className="num">{fmtK(r.avgTicket)}</td>
                <td className="num"><Delta now={r.spend} before={r.before} /></td><td className="num">{fmtK(r.lifetime)}</td><td>{r.lastVisit ? day(r.lastVisit) : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      </>}
    </div>
  );
}
