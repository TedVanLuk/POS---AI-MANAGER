/** Small line-icon set (24px grid, stroke = currentColor) used by the rail and dashboard. */
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5zM16 13.5h1.5',
  scale: 'M12 4v16M7 20h10M5 8h14M5 8l-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0zM12 4l-2-1M12 4l2-1',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  in: 'M10 17l5-5-5-5M15 12H3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4',
  out: 'M14 7l5 5-5 5M19 12H8M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4',
  moonClock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  tablet: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h2M14 12h2M8 16h2M14 16h2',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  minus: 'M5 12h14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
};

export type IconName = keyof typeof PATHS;
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}

/** Deterministic, muted avatar colour from a name. */
const AV = ['#5b6b5a', '#7a6650', '#55657a', '#7a5560', '#5e5a7a', '#6b6f4f', '#4f6f6c', '#7a6a45'];
export const avatarColor = (name: string) => AV[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
export const initialsOf = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function Avatar({ name, photo, size, online, onClick, title }: { name: string; photo?: string | null; size?: 'lg'; online?: boolean; onClick?: () => void; title?: string }) {
  const style = { background: avatarColor(name) };
  const inner = <>
    {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initialsOf(name)}
    {online && <span className="status" aria-label="clocked in" />}
  </>;
  return onClick
    ? <button type="button" className={`avatar ${size ?? ''}`} style={{ ...style, border: 'none', font: 'inherit', fontWeight: 700, padding: 0 }} title={title ?? name} onClick={onClick}>{inner}</button>
    : <span className={`avatar ${size ?? ''}`} style={style} title={title ?? name}>{inner}</span>;
}

/** Employee picture, or an illustrated placeholder (head-and-shoulders) in the person's colour. */
export function Portrait({ name, photo, className }: { name: string; photo?: string | null; className?: string }) {
  if (photo) return <img className={`portrait ${className ?? ''}`} src={photo} alt={`Photo of ${name}`} />;
  const c = avatarColor(name);
  return (
    <svg className={`portrait ${className ?? ''}`} viewBox="0 0 120 120" role="img" aria-label={`No photo yet for ${name}`}>
      <rect width="120" height="120" fill={c} />
      <circle cx="60" cy="48" r="22" fill="rgba(255,255,255,.82)" />
      <path d="M18 120c4-26 20-38 42-38s38 12 42 38z" fill="rgba(255,255,255,.82)" />
      <text x="60" y="54" textAnchor="middle" fontSize="16" fontWeight="800" fill={c} fontFamily="inherit">{initialsOf(name)}</text>
    </svg>
  );
}
