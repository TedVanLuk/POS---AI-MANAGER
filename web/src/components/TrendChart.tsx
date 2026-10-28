import { useState } from 'react';

export interface TrendPoint { date: string; present: number; late: number; absent: number }

/**
 * Stacked bars per day: on-time / late / absent. Categorical slots 1–3 (validated all-pairs),
 * 2px surface gaps between segments, legend + hover tooltip, table fallback via the title attr.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, pad = { l: 28, r: 8, t: 8, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.present + d.absent));
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => (H - pad.b) - (v / max) * (H - pad.t - pad.b);
  const series = [
    { key: 'ontime', label: 'On time', color: 'var(--series-1)', val: (d: TrendPoint) => d.present - d.late },
    { key: 'late', label: 'Late', color: 'var(--series-2)', val: (d: TrendPoint) => d.late },
    { key: 'absent', label: 'Absent', color: 'var(--series-3)', val: (d: TrendPoint) => d.absent },
  ];
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div style={{ position: 'relative' }}>
      <div className="legend" style={{ marginBottom: 6 }}>
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily attendance, last 14 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={pad.l - 6} y={y(t)} fontSize={10} textAnchor="end" dominantBaseline="middle" fill="var(--text-3)">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const x = pad.l + i * bw + bw * 0.18;
          const w = bw * 0.64;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {series.map((s, si) => {
                const v = s.val(d);
                if (v <= 0) return null;
                const first = acc === 0;
                const bottom = y(acc) - (first ? 0 : 2); // 2px surface gap between stacked segments
                const top = y(acc + v);
                acc += v;
                const isTop = series.slice(si + 1).every((n) => n.val(d) <= 0);
                const r = isTop ? Math.min(4, (bottom - top) / 2) : 0; // rounded data-end only
                const path = `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`;
                return <path key={s.key} d={path} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              {(i % 2 === 0 || data.length <= 8) && <text x={x + w / 2} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-3)">{d.date.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${((pad.l + hover * bw + bw) / W) * 100}%`, top: 24 }}>
          <b>{data[hover].date}</b><br />
          On time {data[hover].present - data[hover].late} · Late {data[hover].late} · Absent {data[hover].absent}
        </div>
      )}
    </div>
  );
}
