import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { LiftCard, pctDelta, pesoShort, SEGMENT_LABEL, TierBadge, Tags, type Lift, type Segment } from './shared';

interface Overview {
  today: string;
  guests: { total: number; new30: number; active90: number; marketableSms: number; consentRate: number };
  last30: { revenue: number; visits: number; guests: number; avgTicket: number };
  prev30: { revenue: number; visits: number; guests: number };
  repeatRate: number; identifiedShare: number | null;
  segments: { key: Segment; label: string; advice: string; count: number; spend365: number }[];
  tiers: { name: string; count: number }[];
  months: { month: string; revenue: number; guests: number; newGuests: number; returning: number }[];
  cohorts: { month: string; guests: number; d30: number | null; d60: number | null; d90: number | null }[];
  messages30: { sent: number; cost: number };
  campaigns: ({ id: string; name: string; sentAt: string } & Lift)[];
  watch: { id: string; name: string; tier: string | null; spend365: number; daysSinceLastVisit: number | null; usualGap: number | null; segment: Segment }[];
  top: { id: string; name: string; tier: string | null; spend365: number; visits365: number; lastVisit: string | null; tags: string[] }[];
}

const monthLabel = (m: string) => new Date(`${m}-15T00:00:00`).toLocaleDateString('en-PH', { month: 'short' });

export default function MarketingDashboard() {
  const ov = useApi<Overview>('/api/crm/overview');
  const nav = useNavigate();
  const d = ov.data;
  if (ov.error) return <div className="error">{ov.error}</div>;
  if (!d) return <div className="muted">Loading guests…</div>;
  const revDelta = pctDelta(d.last30.revenue, d.prev30.revenue);
  const guestDelta = pctDelta(d.last30.guests, d.prev30.guests);
  const msgTo = (seg: Segment) => nav(`/admin/marketing/campaigns?segment=${seg}`);
  return (
    <>
      <div className="page-head">
        <div><h1>AI Marketing</h1><div className="muted small">Who your guests are, who is slipping away, and which messages actually brought them back.</div></div>
        <div className="spacer" />
        <Link className="pill-btn" to="/admin/marketing/counter"><Icon name="phone" />Counter check-in</Link>
        <Link className="pill-btn solid" to="/admin/marketing/campaigns?new=1"><Icon name="send" />New campaign</Link>
      </div>

      <div className="kpis mk-kpis">
        <Kpi tone="var(--series-1)" icon="wallet" head="Guest revenue · 30 days" big={pesoShort(d.last30.revenue)} sub={revDelta === null ? 'from identified guests' : `${revDelta >= 0 ? '▲' : '▼'} ${Math.abs(revDelta)}% vs previous 30 days`} />
        <Kpi tone="var(--series-2)" icon="users" head="Guests who came" big={String(d.last30.guests)} sub={`${d.last30.visits} visits · avg ticket ${pesoShort(d.last30.avgTicket)}${guestDelta !== null ? ` · ${guestDelta >= 0 ? '+' : ''}${guestDelta}%` : ''}`} />
        <Kpi tone="var(--series-3)" icon="repeat" head="Repeat rate" big={`${d.repeatRate}%`} sub="of guests active in 90 days came 2+ times" />
        <Kpi tone="var(--gold)" icon="shield" head="Can be messaged" big={`${d.guests.consentRate}%`} sub={`${d.guests.marketableSms} of ${d.guests.total} guests opted in to SMS`} />
        <Kpi tone="var(--bronze)" icon="send" head="Messages · 30 days" big={String(d.messages30.sent)} sub={`cost ₱${d.messages30.cost.toFixed(2)}`} />
      </div>
      {d.identifiedShare === null
        ? <div className="notice" style={{ margin: '14px 0' }}>Connect the POS (Marketing → Settings → POS) to see what share of all sales comes from identified guests. Today only bills with a guest's mobile number are counted.</div>
        : <div className="badge info" style={{ margin: '14px 0' }}>{d.identifiedShare}% of venue sales in the last 30 days are linked to a known guest.</div>}

      <div className="mk-grid">
        <div className="card">
          <div className="card-head"><h2>Guests per month</h2><div className="spacer" /><span className="small">new vs returning</span></div>
          <MonthBars months={d.months} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Do new guests come back?</h2></div>
          <table className="cohort">
            <thead><tr><th>First visit</th><th className="num">Guests</th><th className="num">≤30 d</th><th className="num">≤60 d</th><th className="num">≤90 d</th></tr></thead>
            <tbody>{d.cohorts.map((c) => (
              <tr key={c.month}><td>{new Date(`${c.month}-15T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</td><td className="num">{c.guests}</td>
                {[c.d30, c.d60, c.d90].map((v, i) => <td key={i} className="num"><span className="heat" style={{ '--h': v === null ? 0 : v / 100 } as React.CSSProperties}>{v === null ? '…' : `${v}%`}</span></td>)}</tr>
            ))}</tbody>
          </table>
          <div className="small muted" style={{ marginTop: 8 }}>Share of each month's first-time guests who returned within 30 / 60 / 90 days. “…” = not enough time has passed.</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h2>Segments</h2><div className="spacer" /><span className="small">recency · frequency · spend — click to message a segment</span></div>
        <div className="seg-grid">
          {d.segments.filter((s) => s.count > 0).map((s) => (
            <button key={s.key} className={`seg-card s-${s.key}`} onClick={() => nav(`/admin/marketing/guests?segment=${s.key}`)}>
              <div className="row"><b>{s.label}</b><div className="spacer" /><span className="seg-n">{s.count}</span></div>
              <div className="small muted">{pesoShort(s.spend365)} in 12 months</div>
              <div className="small">{s.advice}</div>
              <span className="link-btn small" onClick={(e) => { e.stopPropagation(); msgTo(s.key); }}>Message this segment →</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mk-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-head"><h2>VIPs slipping away</h2><div className="spacer" /><span className="small">overdue vs their usual rhythm</span></div>
          {!d.watch.length && <div className="muted small">Nobody important is overdue. 🎉</div>}
          <div className="list">
            {d.watch.map((w) => (
              <Link key={w.id} to={`/admin/marketing/guests/${w.id}`} className="list-row">
                <span className="sq warn"><Icon name="alert" /></span>
                <span><span className="t">{w.name} <TierBadge tier={w.tier} /></span><span className="s">{SEGMENT_LABEL[w.segment]} · last visit {w.daysSinceLastVisit}d ago{w.usualGap ? ` · usually every ${Math.round(w.usualGap)}d` : ''}</span></span>
                <span className="plus" style={{ color: 'var(--text)' }}>{pesoShort(w.spend365)}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Top guests · 12 months</h2><div className="spacer" /><Link to="/admin/marketing/guests" className="small">All guests →</Link></div>
          <div className="list">
            {d.top.map((g, i) => (
              <Link key={g.id} to={`/admin/marketing/guests/${g.id}`} className="list-row">
                <span className="sq">{i + 1}</span>
                <span><span className="t">{g.name} <TierBadge tier={g.tier} /></span><span className="s">{g.visits365} visits · <Tags tags={g.tags} max={3} /></span></span>
                <span className="plus" style={{ color: 'var(--text)' }}>{pesoShort(g.spend365)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h2>Did marketing work?</h2><div className="spacer" /><Link to="/admin/marketing/campaigns" className="small">All campaigns →</Link></div>
        {!d.campaigns.length && <div className="muted small">No campaigns sent yet. Every campaign keeps a small holdout group that is not messaged, so you see the real effect — not just who would have come anyway.</div>}
        <div className="grid cols-2">{d.campaigns.map((c) => <LiftCard key={c.id} r={c} title={<b>{c.name}</b>} />)}</div>
      </div>
    </>
  );
}

function Kpi({ tone, icon, head, big, sub }: { tone: string; icon: Parameters<typeof Icon>[0]['name']; head: string; big: string; sub: string }) {
  return (
    <div className="kpi" style={{ '--tone': tone } as React.CSSProperties}>
      <div className="kpi-head">{head}</div><div className="kpi-ico"><Icon name={icon} /></div>
      <div className="kpi-big">{big}</div><div className="kpi-l">{sub}</div>
    </div>
  );
}

function MonthBars({ months }: { months: Overview['months'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, H = 190, pad = { l: 30, r: 6, t: 8, b: 22 };
  const max = Math.max(1, ...months.map((m) => m.guests));
  const bw = (W - pad.l - pad.r) / months.length;
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const m = hover !== null ? months[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <div className="legend" style={{ marginBottom: 6 }}><span><i style={{ background: 'var(--series-1)' }} />Returning</span><span><i style={{ background: 'var(--series-2)' }} />New</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Guests per month: ${months.map((x) => `${monthLabel(x.month)} ${x.guests}`).join(', ')}`}>
        {[0, Math.round(max / 2), max].map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" /><text x={pad.l - 6} y={y(t)} fontSize={10} textAnchor="end" dominantBaseline="middle" fill="var(--text-3)">{t}</text></g>)}
        {months.map((x, i) => {
          const bx = pad.l + i * bw + bw * 0.2; const w = bw * 0.6;
          return (
            <g key={x.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <rect x={bx} y={y(x.returning)} width={w} height={Math.max(0, y(0) - y(x.returning))} fill="var(--series-1)" rx={3} />
              <rect x={bx} y={y(x.guests)} width={w} height={Math.max(0, y(x.returning) - y(x.guests) - 2)} fill="var(--series-2)" rx={3} />
              <text x={bx + w / 2} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-3)">{monthLabel(x.month)}</text>
            </g>
          );
        })}
      </svg>
      {m && <div className="chart-tooltip" style={{ left: `${((pad.l + hover! * bw + bw) / W) * 100}%`, top: 24 }}><b>{monthLabel(m.month)}</b><br />{m.returning} returning · {m.newGuests} new<br />{pesoShort(m.revenue)}</div>}
    </div>
  );
}
