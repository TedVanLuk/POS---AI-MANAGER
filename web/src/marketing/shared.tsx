import { useState, type ReactNode } from 'react';

export type Segment = 'champion' | 'loyal' | 'cant_lose' | 'at_risk' | 'new' | 'promising' | 'need_attention' | 'hibernating' | 'lost' | 'no_visits';
export const SEGMENT_LABEL: Record<Segment, string> = {
  champion: 'Champions', loyal: 'Loyal regulars', cant_lose: "Can't lose", at_risk: 'At risk', new: 'New guests', promising: 'Promising',
  need_attention: 'Need attention', hibernating: 'Hibernating', lost: 'Lost', no_visits: 'No visits yet',
};
const SEG_TONE: Partial<Record<Segment, string>> = { champion: 'good', loyal: 'good', cant_lose: 'bad', at_risk: 'warn', new: 'info' };

export interface Reward { key: string; name: string; points: number; kind: string; value: number; item?: string }
export interface Consent { granted: boolean; at: string; source: string; version?: string | null }
export interface GuestSummary {
  id: string; name: string; phoneDisplay: string; email: string | null; tier: string | null; segment: Segment; tags: string[]; pointsBalance: number;
  visits: number; spend: number; spend365: number; avgSpend: number; lastVisit: string | null; daysSinceLastVisit: number | null; overdue: boolean;
  marketable: { sms: boolean; viber: boolean; email: boolean }; birthday: string | null; daysToBirthday: number | null; erasedAt: string | null; source: string; createdAt: string;
}
export interface AudienceFilter {
  segments?: Segment[]; tags?: string[]; tiers?: string[]; minVisits?: number; maxVisits?: number; minDaysSinceLastVisit?: number; maxDaysSinceLastVisit?: number;
  minSpend365?: number; birthdayWithinDays?: number; categories?: string[];
}
export interface Lift {
  windowDays: number; sentOn: string; complete: boolean; liftPts: number | null; incrementalRevenue: number | null; cost: number; roi: number | null; verdict: string;
  confidence: 'proven' | 'likely' | 'unclear' | 'none' | 'too_small';
  treated: { customers: number; converted: number; rate: number; revenue: number; revenuePerCustomer: number };
  holdout: { customers: number; converted: number; rate: number; revenue: number; revenuePerCustomer: number };
}

export const pesoShort = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  return `${n < 0 ? '−' : ''}₱${a >= 1_000_000 ? `${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M` : a >= 10_000 ? `${Math.round(a / 1000)}k` : Math.round(a).toLocaleString('en-PH')}`;
};
export const ago = (d: number | null) => (d === null ? 'never' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
export const pctDelta = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null);

export function SegmentBadge({ s }: { s: Segment }) { return <span className={`badge ${SEG_TONE[s] ?? ''}`}>{SEGMENT_LABEL[s]}</span>; }
export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return <span className="badge tier" data-tier={tier.toLowerCase()}>{tier}</span>;
}
export function Tags({ tags, max = 4 }: { tags: string[]; max?: number }) {
  return <span className="tag-row">{tags.slice(0, max).map((t) => <span key={t} className={`tag ${t === 'VIP' ? 'vip' : ''}`}>{t}</span>)}{tags.length > max && <span className="tag">+{tags.length - max}</span>}</span>;
}
export function ConsentDot({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`consent-dot ${ok ? 'on' : ''}`} title={ok ? `${label}: marketing consent on file` : `${label}: no marketing consent — only transactional messages`}>{label}</span>;
}

export function LiftCard({ r, title }: { r: Lift; title?: ReactNode }) {
  const tone = r.confidence === 'proven' ? 'good' : r.confidence === 'likely' ? 'info' : r.confidence === 'none' ? 'bad' : '';
  const label = { proven: 'Proven lift', likely: 'Likely working', unclear: 'Unclear', none: 'No lift', too_small: 'Too small to measure' }[r.confidence];
  return (
    <div className="lift">
      <div className="row">{title}<div className="spacer" /><span className={`badge ${tone}`}>{label}</span>{!r.complete && <span className="badge">measuring · {r.windowDays}d window</span>}</div>
      <div className="lift-bars" role="img" aria-label={`Messaged ${r.treated.rate}% came back, holdout ${r.holdout.rate}%`}>
        {[['Messaged', r.treated], ['Holdout (not messaged)', r.holdout]].map(([k, g]) => {
          const x = g as Lift['treated'];
          return (
            <div key={k as string} className="lift-row">
              <span>{k as string} <span className="muted">· {x.customers}</span></span>
              <div className="lift-track"><i style={{ width: `${Math.min(100, x.rate)}%` }} className={k === 'Messaged' ? 't' : 'h'} /></div>
              <b>{x.rate}%</b>
            </div>
          );
        })}
      </div>
      <div className="lift-stats">
        <div><span>Lift</span><b>{r.liftPts === null ? '—' : `${r.liftPts > 0 ? '+' : ''}${r.liftPts} pts`}</b></div>
        <div><span>Extra sales</span><b>{pesoShort(r.incrementalRevenue)}</b></div>
        <div><span>Message cost</span><b>₱{r.cost.toFixed(2)}</b></div>
        <div><span>Return</span><b>{r.roi === null ? '—' : `${r.roi.toLocaleString('en-PH')}×`}</b></div>
      </div>
      <div className="small muted">{r.verdict}</div>
    </div>
  );
}

const SEGS = Object.keys(SEGMENT_LABEL) as Segment[];
/** Audience builder used by campaigns and automations. */
export function AudienceEditor({ value, onChange, tags, tiers, categories }: { value: AudienceFilter; onChange: (f: AudienceFilter) => void; tags: string[]; tiers: string[]; categories: string[] }) {
  const set = (patch: Partial<AudienceFilter>) => onChange(Object.fromEntries(Object.entries({ ...value, ...patch }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length) && !Number.isNaN(v))) as AudienceFilter);
  const toggle = <K extends 'segments' | 'tags' | 'tiers' | 'categories'>(k: K, x: string) => {
    const cur = (value[k] ?? []) as string[];
    set({ [k]: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x] } as Partial<AudienceFilter>);
  };
  const num = (k: keyof AudienceFilter) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<AudienceFilter>);
  return (
    <div className="audience">
      <div className="aud-group"><span>Segment</span><div className="chip-pick">{SEGS.map((s) => <button type="button" key={s} className={value.segments?.includes(s) ? 'on' : ''} onClick={() => toggle('segments', s)}>{SEGMENT_LABEL[s]}</button>)}</div></div>
      <div className="aud-group"><span>Tier</span><div className="chip-pick">{tiers.map((s) => <button type="button" key={s} className={value.tiers?.includes(s) ? 'on' : ''} onClick={() => toggle('tiers', s)}>{s}</button>)}</div></div>
      {tags.length > 0 && <div className="aud-group"><span>Tag (any)</span><div className="chip-pick">{tags.map((s) => <button type="button" key={s} className={value.tags?.includes(s) ? 'on' : ''} onClick={() => toggle('tags', s)}>{s}</button>)}</div></div>}
      {categories.length > 0 && <div className="aud-group"><span>Bought (any)</span><div className="chip-pick">{categories.map((s) => <button type="button" key={s} className={value.categories?.includes(s) ? 'on' : ''} onClick={() => toggle('categories', s)}>{s}</button>)}</div></div>}
      <div className="form-grid">
        <label className="field">Not seen for at least (days)<input type="number" min={0} value={value.minDaysSinceLastVisit ?? ''} onChange={num('minDaysSinceLastVisit')} /></label>
        <label className="field">Seen within (days)<input type="number" min={0} value={value.maxDaysSinceLastVisit ?? ''} onChange={num('maxDaysSinceLastVisit')} /></label>
        <label className="field">Min. visits<input type="number" min={0} value={value.minVisits ?? ''} onChange={num('minVisits')} /></label>
        <label className="field">Min. spend, 12 months (₱)<input type="number" min={0} step={1000} value={value.minSpend365 ?? ''} onChange={num('minSpend365')} /></label>
        <label className="field">Birthday within (days)<input type="number" min={0} max={366} value={value.birthdayWithinDays ?? ''} onChange={num('birthdayWithinDays')} /></label>
      </div>
    </div>
  );
}

/** Template textarea with merge-field chips and a live SMS part counter. */
export function TemplateEditor({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [el, setEl] = useState<HTMLTextAreaElement | null>(null);
  const insert = (v: string) => {
    const at = el?.selectionStart ?? value.length;
    onChange(`${value.slice(0, at)}{{${v}}}${value.slice(at)}`);
  };
  const unicode = [...value].some((c) => c.codePointAt(0)! > 0x7e && !'£¥èéùìòÇØøÅåÆæßÉÄÖÑÜ§¿äöñüà€'.includes(c));
  const len = value.length + 30; // + sender name and "Reply STOP to opt out."
  const per = unicode ? 70 : 160; const per2 = unicode ? 67 : 153;
  const parts = len <= per ? 1 : Math.ceil(len / per2);
  return (
    <div>
      <div className="row" style={{ gap: '.35rem', marginBottom: '.35rem' }}>
        <span className="small muted">Insert:</span>
        {['firstName', 'points', 'tier', 'reward', 'business'].map((v) => <button type="button" key={v} className="btn sm" onClick={() => insert(v)}>{`{{${v}}}`}</button>)}
      </div>
      <textarea ref={setEl} value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} placeholder="Hi {{firstName}}, …" />
      <div className="small muted">≈ {len} characters incl. sender and opt-out line · {parts} SMS part{parts > 1 ? 's' : ''}{unicode ? ' · contains special characters (Unicode: 70 per part) — avoid emoji and ₱ to save cost' : ''}</div>
    </div>
  );
}
