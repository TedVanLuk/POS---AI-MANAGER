import { useState } from 'react';

/**
 * Radial "burst" for the attendance mix: one spoke per share point, coloured by category in
 * order (on time → late → absent). Identity is also carried by the legend rows beside it.
 */
export function Burst({ parts, size = 210 }: { parts: { value: number; color: string; label: string }[]; size?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const N = 72;
  const c = size / 2;
  const r0 = size * 0.25;
  let acc = 0;
  const bounds = parts.map((p) => { acc += p.value; return { ...p, upto: (acc / total) * N }; });
  const spokes = Array.from({ length: N }, (_, i) => {
    const part = bounds.find((b) => i < b.upto) ?? bounds[bounds.length - 1];
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const len = size * (0.15 + 0.07 * Math.abs(Math.sin(i * 0.9)) + (i % 3 === 0 ? 0.04 : 0));
    return { x1: c + Math.cos(a) * r0, y1: c + Math.sin(a) * r0, x2: c + Math.cos(a) * (r0 + len), y2: c + Math.sin(a) * (r0 + len), color: part.color, i };
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: 'block', margin: '0 auto' }} role="img"
      aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
      {spokes.map((s) => <line key={s.i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={2} strokeLinecap="round" />)}
    </svg>
  );
}

export interface DayPoint { date: string; workedHours: number; present: number; late: number; absent: number; lateMinutes: number }
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'short' });

/** Labor hours per day. One series: muted bars, the focused day in the accent with a value pill. */
export function HoursBars({ data }: { data: DayPoint[] }) {
  const peak = data.reduce((best, d, i) => (d.workedHours > data[best].workedHours ? i : best), 0);
  const [focus, setFocus] = useState<number | null>(null);
  const f = focus ?? peak;
  const W = 640, H = 230, pad = { l: 8, r: 8, t: 46, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.workedHours));
  const slot = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(34, slot * 0.62);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const x = (i: number) => pad.l + i * slot + (slot - bw) / 2;
  const d = data[f];
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Labor hours per day: ${data.map((p) => `${p.date} ${p.workedHours} h`).join(', ')}`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--border-strong)" />
        {data.map((p, i) => {
          const top = y(p.workedHours);
          const h = Math.max(2, H - pad.b - top);
          const r = Math.min(6, h / 2, bw / 2);
          const path = `M${x(i)},${H - pad.b} V${top + r} Q${x(i)},${top} ${x(i) + r},${top} H${x(i) + bw - r} Q${x(i) + bw},${top} ${x(i) + bw},${top + r} V${H - pad.b} Z`;
          return (
            <g key={p.date} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)} onClick={() => setFocus(i)} style={{ cursor: 'pointer' }}>
              <rect x={pad.l + i * slot} y={pad.t - 30} width={slot} height={H - pad.t + 30 - pad.b} fill="transparent" />
              <path d={path} fill={i === f ? 'var(--accent)' : 'var(--bar)'} />
              {i === f && <line x1={x(i) + bw / 2} x2={x(i) + bw / 2} y1={top - 6} y2={pad.t - 6} stroke="var(--border-strong)" strokeDasharray="2 3" />}
              <text x={x(i) + bw / 2} y={H - 8} fontSize={11} textAnchor="middle" fill={i === f ? 'var(--text)' : 'var(--text-3)'} fontWeight={i === f ? 700 : 500}>{dayLabel(p.date)}</text>
            </g>
          );
        })}
      </svg>
      {d && (
        <div className="chart-pill" style={{ left: `${((x(f) + bw / 2) / W) * 100}%`, top: `${((pad.t - 8) / H) * 100}%` }}>
          <span className="muted">{new Date(`${d.date}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
          <b>{d.workedHours.toLocaleString('en-PH')} h</b>
          <span className="muted">{d.present} in · {d.late} late</span>
        </div>
      )}
    </div>
  );
}

/** Lates per day as a line with points; the latest point is ringed. */
export function LatesLine({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300, H = 120, pad = { l: 6, r: 10, t: 12, b: 22 };
  const max = Math.max(2, ...data.map((d) => d.late));
  const step = (W - pad.l - pad.r) / Math.max(1, data.length - 1);
  const px = (i: number) => pad.l + i * step;
  const py = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${px(i)},${py(d.late)}`).join(' ');
  const area = `${line} L${px(data.length - 1)},${H - pad.b} L${px(0)},${H - pad.b} Z`;
  const last = data.length - 1;
  const h = hover ?? last;
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Late arrivals per day: ${data.map((d) => `${d.date} ${d.late}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}>
        {[0, max].map((v) => <line key={v} x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)} stroke="var(--border)" />)}
        <path d={area} fill="var(--text)" opacity={0.05} />
        <path d={line} fill="none" stroke="var(--text-2)" strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)}>
            <rect x={px(i) - step / 2} y={0} width={step} height={H} fill="transparent" />
            {(i === h) && <circle cx={px(i)} cy={py(d.late)} r={7} fill="var(--frame)" stroke="var(--text)" strokeWidth={2} />}
            <circle cx={px(i)} cy={py(d.late)} r={i === h ? 3 : 2.2} fill="var(--text)" />
            {(i % 3 === last % 3) && <text x={px(i)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-3)">{d.date.slice(8)}</text>}
          </g>
        ))}
      </svg>
      <div className="chart-tooltip" style={{ left: `min(calc(${(px(h) / W) * 100}% - 40px), calc(100% - 120px))`, top: -6 }}>
        {new Date(`${data[h].date}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}: <b>{data[h].late}</b> late · {data[h].lateMinutes} min
      </div>
    </div>
  );
}

/** Progress ring (e.g. how far into the pay period we are). */
export function Ring({ pct, size = 54 }: { pct: number; size?: number }) {
  const r = size / 2 - 4;
  const C = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={4} strokeLinecap="round"
        strokeDasharray={`${(C * Math.min(100, pct)) / 100} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text)">{pct}%</text>
    </svg>
  );
}
