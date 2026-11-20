import { useState, type ReactNode } from 'react';

/** Chart kit for the CRM command center: gold on black, thin grid, condensed numerals. */

export const fmtK = (n: number) => {
  const a = Math.abs(n);
  return `${n < 0 ? '−' : ''}₱${a >= 1_000_000 ? `${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M` : a >= 1000 ? `${(a / 1000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : Math.round(a)}`;
};

export function Panel({ title, sub, right, children, className }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cx-panel ${className ?? ''}`}>
      <header><div><h2>{title}</h2>{sub && <span>{sub}</span>}</div>{right}</header>
      {children}
    </section>
  );
}

export function Delta({ now, before, suffix = '%' }: { now: number; before: number; suffix?: string }) {
  if (!before) return <span className="cx-delta">new</span>;
  const p = Math.round(((now - before) / before) * 100);
  return <span className={`cx-delta ${p >= 0 ? 'up' : 'down'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}{suffix}</span>;
}

/** Big number tile. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="cx-stat"><span className="l">{label}</span><b>{value}</b>{sub && <span className="s">{sub}</span>}</div>;
}

/** Donut gauge 0–100 with the value in the middle. */
export function Gauge({ value, label, size = 120 }: { value: number; label: string; size?: number }) {
  const r = 42, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <figure className="cx-gauge" style={{ width: size }}>
      <svg viewBox="0 0 100 100" role="img" aria-label={`${label}: ${Math.round(v)}%`}>
        <circle cx="50" cy="50" r={r} className="track" />
        <circle cx="50" cy="50" r={r} className="val" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
        <text x="50" y="54" textAnchor="middle">{Math.round(v)}%</text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Concentric rings: each item's share of a total, like the radial in the reference board. */
export function Rings({ items, center }: { items: { label: string; value: number; share: number }[]; center: { value: string; label: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const tones = ['var(--cx-gold)', 'var(--cx-gold-2)', 'var(--cx-gray)', 'var(--cx-gray-2)', 'var(--cx-gold-3)', 'var(--cx-gray-3)'];
  return (
    <div className="cx-rings">
      <svg viewBox="0 0 200 200" role="img" aria-label={items.map((i) => `${i.label} ${i.share}%`).join(', ')}>
        {items.slice(0, 6).map((it, i) => {
          const r = 88 - i * 13, c = 2 * Math.PI * r;
          return (
            <g key={it.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.35}>
              <circle cx="100" cy="100" r={r} className="track" />
              <circle cx="100" cy="100" r={r} fill="none" stroke={tones[i]} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${Math.max(0.5, (it.share / 100) * c)} ${c}`} transform="rotate(-90 100 100)" />
            </g>
          );
        })}
        <text x="100" y="98" textAnchor="middle" className="big">{hover !== null ? `${items[hover].share}%` : center.value}</text>
        <text x="100" y="116" textAnchor="middle" className="small">{hover !== null ? items[hover].label : center.label}</text>
      </svg>
      <ul>{items.slice(0, 6).map((it, i) => <li key={it.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><i style={{ background: tones[i] }} />{it.label}<b>{fmtK(it.value)}</b><span>{it.share}%</span></li>)}</ul>
    </div>
  );
}

/** Vertical bars (optionally stacked in two parts) with hover readout. */
export function Bars({ data, height = 190, label, fmt = fmtK, twoTone }: { data: { key: string; label: string; value: number; part?: number }[]; height?: number; label: string; fmt?: (n: number) => string; twoTone?: [string, string] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, pb = 20, pt = 8, pl = 4;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - pl) / Math.max(1, data.length);
  const y = (v: number) => H - pb - (v / max) * (H - pb - pt);
  const every = Math.ceil(data.length / 12);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="cx-bars">
      <div className="cx-readout">{h ? <><b>{fmt(h.value)}</b> {h.label}{h.part !== undefined && twoTone ? ` · ${twoTone[0]} ${fmt(h.part)} · ${twoTone[1]} ${fmt(h.value - h.part)}` : ''}</> : <span>{label}</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={0} x2={W} y1={y(max * t)} y2={y(max * t)} className="grid" />)}
        {data.map((d, i) => {
          const x = pl + i * bw + bw * 0.16, w = Math.max(1, bw * 0.68);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pl + i * bw} y={0} width={bw} height={H} fill="transparent" />
              <rect x={x} y={y(d.value)} width={w} height={Math.max(0, y(0) - y(d.value))} className={hover === i ? 'bar on' : 'bar'} />
              {d.part !== undefined && <rect x={x} y={y(d.part)} width={w} height={Math.max(0, y(0) - y(d.part))} className="bar part" />}
            </g>
          );
        })}
      </svg>
      <div className="cx-xlabels">{data.map((d, i) => <span key={d.key} style={{ visibility: i % every === 0 ? 'visible' : 'hidden' }}>{d.label}</span>)}</div>
    </div>
  );
}

/** Horizontal bars as HTML rows. */
export function HBars({ rows, fmt = fmtK }: { rows: { label: ReactNode; value: number; note?: ReactNode }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="cx-hbars">
      {rows.map((r, i) => (
        <div key={i} className="cx-hbar">
          <span className="lbl">{r.label}</span>
          <span className="trk"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <b>{fmt(r.value)}</b>{r.note !== undefined && <span className="note">{r.note}</span>}
        </div>
      ))}
    </div>
  );
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Business weekday × hour heat grid. */
export function HeatGrid({ heat }: { heat: { hours: number[]; rows: number[][]; max: number } }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const hl = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  return (
    <div className="cx-heat">
      <div className="cx-readout">{hover ? <><b>{fmtK(heat.rows[hover[0]][hover[1]])}</b> {WD[hover[0]]} night · {hl(heat.hours[hover[1]])}</> : <span>Spend by night and hour</span>}</div>
      <div className="grid" style={{ gridTemplateColumns: `34px repeat(${heat.hours.length}, minmax(0, 1fr))` }}>
        {heat.rows.map((row, r) => [
          <span key={`l${r}`} className="cx-rl">{WD[r]}</span>,
          ...row.map((v, c) => <i key={`${r}-${c}`} onMouseEnter={() => setHover([r, c])} onMouseLeave={() => setHover(null)} style={{ opacity: v ? 0.12 + 0.88 * Math.sqrt(v / (heat.max || 1)) : 0.05 }} title={`${WD[r]} ${hl(heat.hours[c])}: ${fmtK(v)}`} />),
        ])}
        <span />
        {heat.hours.map((h, c) => <span key={`h${c}`} className="cx-hl">{c % 3 === 0 ? hl(h) : ''}</span>)}
      </div>
    </div>
  );
}

/** Pareto: share of revenue from the top X% of customers. */
export function Pareto({ points }: { points: { customersPct: number; revenuePct: number }[] }) {
  const W = 320, H = 200, p = 26;
  const x = (v: number) => p + (v / 100) * (W - p - 8), y = (v: number) => H - p - (v / 100) * (H - p - 8);
  const path = points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.customersPct)},${y(pt.revenuePct)}`).join('');
  const at20 = points.find((pt) => pt.customersPct >= 20);
  return (
    <svg className="cx-pareto" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Top 20% of customers bring ${at20?.revenuePct ?? 0}% of revenue`}>
      {[0, 25, 50, 75, 100].map((t) => <g key={t}><line x1={p} x2={W - 8} y1={y(t)} y2={y(t)} className="grid" /><text x={p - 4} y={y(t) + 3} textAnchor="end">{t}%</text><text x={x(t)} y={H - 8} textAnchor="middle">{t}%</text></g>)}
      <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} className="diag" />
      <path d={`${path}L${x(100)},${y(0)}L${x(0)},${y(0)}Z`} className="area" />
      <path d={path} className="line" />
      {at20 && <><line x1={x(at20.customersPct)} x2={x(at20.customersPct)} y1={y(0)} y2={y(at20.revenuePct)} className="mark" /><circle cx={x(at20.customersPct)} cy={y(at20.revenuePct)} r="4" className="dot" /></>}
    </svg>
  );
}

/** Frequency × average ticket, one dot per customer, sized by spend. */
export function Scatter({ points, onPick }: { points: { id: string; name: string; tier: string | null; visits: number; avgTicket: number; spend: number }[]; onPick?: (id: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 260, pl = 46, pb = 26;
  const mx = Math.max(2, ...points.map((p) => p.visits)), my = Math.max(1, ...points.map((p) => p.avgTicket)), ms = Math.max(1, ...points.map((p) => p.spend));
  const x = (v: number) => pl + (v / mx) * (W - pl - 10), y = (v: number) => H - pb - (Math.sqrt(v) / Math.sqrt(my)) * (H - pb - 10);
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="cx-scatter">
      <div className="cx-readout">{h ? <><b>{h.name}</b> {h.tier ?? ''} · {h.visits} visits · avg {fmtK(h.avgTicket)} · {fmtK(h.spend)}</> : <span>Each dot is a customer — right = comes often, up = spends more per visit</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Customers by visits and average ticket">
        {[0.25, 0.5, 1].map((t) => <g key={t}><line x1={pl} x2={W} y1={y(my * t)} y2={y(my * t)} className="grid" /><text x={pl - 6} y={y(my * t) + 3} textAnchor="end">{fmtK(my * t)}</text></g>)}
        {[0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={x(mx * t)} y={H - 8} textAnchor="middle">{Math.round(mx * t)}</text>)}
        {points.map((p, i) => <circle key={p.id} cx={x(p.visits)} cy={y(p.avgTicket)} r={3 + 9 * Math.sqrt(p.spend / ms)} className={`pt ${p.tier ? `t-${p.tier.toLowerCase().replace(/\W+/g, '')}` : ''} ${hover === i ? 'on' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(p.id)} />)}
      </svg>
    </div>
  );
}
