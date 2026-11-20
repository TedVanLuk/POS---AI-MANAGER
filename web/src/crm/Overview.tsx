import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks';
import { LiftCard, SEGMENT_LABEL, type Lift, type Segment } from '../marketing/shared';
import { Bars, Delta, fmtK, Gauge, HBars, HeatGrid, Panel, Rings, Stat } from './charts';
import type { SpendingData } from './Spending';

interface Overview {
  guests: { total: number; new30: number; active90: number; marketableSms: number; consentRate: number };
  last30: { revenue: number; visits: number; guests: number; avgTicket: number };
  prev30: { revenue: number; visits: number; guests: number };
  repeatRate: number;
  segments: { key: Segment; label: string; count: number; spend365: number }[];
  months: { month: string; revenue: number; guests: number; newGuests: number; returning: number }[];
  cohorts: { month: string; guests: number; d30: number | null; d60: number | null; d90: number | null }[];
  campaigns: ({ id: string; name: string } & Lift)[];
  watch: { id: string; name: string; tier: string | null; spend365: number; daysSinceLastVisit: number | null; usualGap: number | null; segment: Segment }[];
  top: { id: string; name: string; tier: string | null; spend365: number; visits365: number }[];
}

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

export default function OverviewPage() {
  const ov = useApi<Overview>('/api/crm/overview');
  const sp = useApi<SpendingData>('/api/crm/spending?days=30');
  const sp90 = useApi<SpendingData>('/api/crm/spending?days=90');
  const nav = useNavigate();
  const o = ov.data, s = sp.data, s90 = sp90.data;
  if (ov.error || sp.error) return <div className="error">{ov.error ?? sp.error}</div>;
  if (!o || !s || !s90) return <div className="cx-loading">Loading customers…</div>;
  const k = s.kpis;
  const vipRevenue = s90.byTier.filter((t) => t.name !== 'Member' && t.name !== '—').reduce((a, t) => a + t.share, 0);
  return (
    <div className="cx-page">
      <div className="cx-title">
        <div><h1>Command center</h1><p>Customers of the last 30 days, compared with the 30 before.</p></div>
        <div className="cx-actions"><Link className="cx-btn" to="/crm/counter">Counter check-in</Link><Link className="cx-btn gold" to="/crm/campaigns?new=1">New campaign</Link></div>
      </div>

      <div className="cx-stats">
        <Stat label="Customer revenue" value={fmtK(k.revenue)} sub={<Delta now={k.revenue} before={k.prevRevenue} />} />
        <Stat label="Paying customers" value={k.customers} sub={<Delta now={k.customers} before={k.prevCustomers} />} />
        <Stat label="Average ticket" value={fmtK(k.avgTicket)} sub={<Delta now={k.avgTicket} before={k.prevAvgTicket} />} />
        <Stat label="Visits per customer" value={k.visitsPerCustomer.toFixed(1)} sub={`${k.visits} visits`} />
        <Stat label="Came back" value={k.retained} sub={`${k.gained} new · ${k.lost} didn't return`} />
        <Stat label="In the database" value={o.guests.total} sub={`${o.guests.new30} new this month`} />
      </div>

      <div className="cx-grid g-3">
        <Panel title="Revenue by tier" sub="share of the last 90 days">
          <Rings items={s90.byTier.map((t) => ({ label: t.name, value: t.revenue, share: t.share }))} center={{ value: `${vipRevenue}%`, label: 'from tier guests' }} />
        </Panel>
        <Panel title="Daily customer revenue" sub="last 30 days" right={<Link to="/crm/spending" className="cx-link">Spending →</Link>}>
          <Bars label="Hover a day" data={s.series.map((x) => ({ key: x.date, label: day(x.date), value: x.revenue }))} />
          <div className="cx-mini-stats"><span>Best night <b>{(() => { const b = [...s.series].sort((a, c) => c.revenue - a.revenue)[0]; return b ? `${day(b.date)} · ${fmtK(b.revenue)}` : '—'; })()}</b></span><span>Top 20% bring <b>{k.top20Share}%</b></span></div>
        </Panel>
        <Panel title="When customers spend" sub="90 days · night × hour">
          <HeatGrid heat={s90.heat} />
        </Panel>
      </div>

      <div className="cx-grid g-3b">
        <Panel title="Segments" sub="customers per segment" right={<Link to="/crm/customers" className="cx-link">Database →</Link>}>
          <HBars fmt={(n) => String(n)} rows={o.segments.filter((x) => x.count).map((x) => ({ label: <button className="cx-linkbtn" onClick={() => nav(`/crm/customers?segment=${x.key}`)}>{x.label}</button>, value: x.count, note: fmtK(x.spend365) }))} />
        </Panel>
        <Panel title="Health">
          <div className="cx-gauges">
            <Gauge size={104} value={o.repeatRate} label="Repeat rate (90 d)" />
            <Gauge size={104} value={o.guests.consentRate} label="Can be messaged" />
            <Gauge size={104} value={k.top20Share} label="Revenue from top 20%" />
          </div>
          <table className="cx-table compact">
            <thead><tr><th>New in</th><th className="num">Customers</th><th className="num">Back ≤30 d</th><th className="num">≤90 d</th></tr></thead>
            <tbody>{o.cohorts.slice(-4).map((c) => <tr key={c.month}><td>{new Date(`${c.month}-15T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</td><td className="num">{c.guests}</td><td className="num">{c.d30 === null ? '…' : `${c.d30}%`}</td><td className="num">{c.d90 === null ? '…' : `${c.d90}%`}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Top customers" sub="12 months">
          <ol className="cx-rank">{o.top.map((g) => <li key={g.id}><Link to={`/crm/customers/${g.id}`}><b>{g.name}</b><span>{g.tier} · {g.visits365} visits</span></Link><em>{fmtK(g.spend365)}</em></li>)}</ol>
        </Panel>
      </div>

      <div className="cx-grid g-2">
        <Panel title="Big spenders slipping away" sub="away twice as long as usual">
          {!o.watch.length && <div className="cx-muted">Nobody important is overdue.</div>}
          <ol className="cx-rank warn">{o.watch.map((w) => <li key={w.id}><Link to={`/crm/customers/${w.id}`}><b>{w.name}</b><span>{w.tier} · {SEGMENT_LABEL[w.segment]} · last visit {w.daysSinceLastVisit}d ago{w.usualGap ? ` · usually every ${Math.round(w.usualGap)}d` : ''}</span></Link><em>{fmtK(w.spend365)}</em></li>)}</ol>
        </Panel>
        <Panel title="Did marketing work?" sub="messaged vs holdout" right={<Link to="/crm/campaigns" className="cx-link">Campaigns →</Link>}>
          {!o.campaigns.length && <div className="cx-muted">No campaigns sent yet.</div>}
          {o.campaigns.slice(0, 2).map((c) => <LiftCard key={c.id} r={c} title={<b>{c.name}</b>} />)}
        </Panel>
      </div>
      <Panel title="Customers per month" sub="returning vs new">
        <Bars label="Hover a month" twoTone={['returning', 'new']} fmt={(n) => String(n)} height={150}
          data={o.months.map((m) => ({ key: m.month, label: new Date(`${m.month}-15T00:00:00`).toLocaleDateString('en-PH', { month: 'short' }), value: m.guests, part: m.returning }))} />
      </Panel>
    </div>
  );
}
