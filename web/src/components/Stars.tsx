import { useState } from 'react';

/** Read-only 5-star display with half stars. */
export function Stars({ value, size = 18, label }: { value: number; size?: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${value} out of 5 stars`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = value >= i ? 1 : value >= i - 0.5 ? 0.5 : 0;
        return <span key={i} className="star"><span className="bg">★</span><span className="fg" style={{ width: `${fill * 100}%` }}>★</span></span>;
      })}
    </span>
  );
}

/** 5-star input: click the left half of a star for a half star. Keyboard: arrows change by ½. */
export function StarInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <span className="star-input" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={5} aria-valuenow={value}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, value + 0.5)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, value - 0.5)); }
      }}
      onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = shown >= i ? 1 : shown >= i - 0.5 ? 0.5 : 0;
        const pick = (e: React.MouseEvent<HTMLSpanElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          return e.clientX - r.left < r.width / 2 ? i - 0.5 : i;
        };
        return (
          <span key={i} className="star" onMouseMove={(e) => setHover(pick(e))} onClick={(e) => onChange(pick(e) === value ? 0 : pick(e))}>
            <span className="bg">★</span><span className="fg" style={{ width: `${fill * 100}%` }}>★</span>
          </span>
        );
      })}
      <span className="star-val">{value ? value.toFixed(1) : '—'}</span>
    </span>
  );
}
