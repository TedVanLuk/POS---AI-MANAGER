export type AttrKey = 'PUN' | 'ATT' | 'SPD' | 'HUS' | 'SAL' | 'DIS' | 'REP';
export interface CardData {
  employeeId: string; name: string; employeeNo: string; position: string | null;
  overall: number; tier: 'legend' | 'gold' | 'silver' | 'bronze';
  attributes: Record<AttrKey, number | null>;
  period: { from: string; to: string; days: number };
}
export const ATTR_LABELS: Record<AttrKey, string> = { PUN: 'Punctuality', ATT: 'Attendance', SPD: 'Speed', HUS: 'Hustle', SAL: 'Sales', DIS: 'Discipline', REP: 'Reputation' };
const ORDER: AttrKey[] = ['PUN', 'ATT', 'SPD', 'HUS', 'SAL', 'DIS', 'REP'];

/** Hexagon/heptagon radar of the attributes that have data. Single series → no legend; the card names it. */
function Radar({ attrs }: { attrs: Record<AttrKey, number | null> }) {
  const keys = ORDER.filter((k) => attrs[k] !== null);
  if (keys.length < 3) return null;
  const size = 200, c = size / 2, r = 70;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
    return [c + Math.cos(a) * r * (v / 99), c + Math.sin(a) * r * (v / 99)];
  };
  const poly = (v: (i: number) => number) => keys.map((_, i) => pt(i, v(i)).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: 210, display: 'block', margin: '0 auto' }} role="img" aria-label={keys.map((k) => `${ATTR_LABELS[k]} ${attrs[k]}`).join(', ')}>
      {[33, 66, 99].map((g) => <polygon key={g} points={poly(() => g)} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />)}
      {keys.map((_, i) => { const [x, y] = pt(i, 99); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.15} />; })}
      <polygon points={poly((i) => attrs[keys[i]]!)} fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      {keys.map((k, i) => { const [x, y] = pt(i, attrs[k]!); return <circle key={k} cx={x} cy={y} r={3.5}><title>{`${ATTR_LABELS[k]}: ${attrs[k]}`}</title></circle>; })}
      {keys.map((k, i) => { const [x, y] = pt(i, 122); return <text key={k} x={x} y={y} fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="middle">{k}</text>; })}
    </svg>
  );
}

export function FighterCard({ card, onClick }: { card: CardData; onClick?: () => void }) {
  return (
    <div className={`fcard tier-${card.tier}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <div className="top">
        <div>
          <div className="ovr">{card.overall}</div>
          <div className="pos">{card.position ?? 'Staff'}</div>
        </div>
        <span className="tier">{card.tier}</span>
      </div>
      <Radar attrs={card.attributes} />
      <div className="name">{card.name}</div>
      <div className="attrs">
        {ORDER.map((k) => (
          <div key={k} title={ATTR_LABELS[k]}>{card.attributes[k] ?? '—'}<span className="k">{k}</span></div>
        ))}
      </div>
    </div>
  );
}
