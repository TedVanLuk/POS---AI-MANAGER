import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso } from '../api';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { ConsentBox } from './Guests';
import { pesoShort, TierBadge, type GuestSummary, type Reward } from './shared';

interface Lookup { found: boolean; valid: boolean; phone: string | null; profile?: GuestSummary; recognition?: string; preferences?: Record<string, string>; rewards?: Reward[]; nextReward?: { reward: Reward; remaining: number } | null; consentText?: string }
interface Done { customerId: string; created: boolean; duplicate: boolean; pointsEarned: number; profile: GuestSummary; recognition: string; rewards: Reward[]; nextReward: { reward: Reward; remaining: number } | null; loyaltyName: string }

/**
 * Counter check-in: the cashier types the guest's mobile, the amount, done. No app, no card, no training —
 * the same flow for a café stamp card and a nightclub bar tab.
 */
export default function Counter() {
  const settings = useApi<{ settings: { categories: string[]; loyalty: { name: string; enabled: boolean } } }>('/api/crm/settings');
  const [phone, setPhone] = useState('');
  const [look, setLook] = useState<Lookup | null>(null);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [amount, setAmount] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [receipt, setReceipt] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const digits = phone.replace(/\D/g, '');
  useEffect(() => {
    setLook(null); setErr(null);
    if (digits.length < 10) return;
    const t = setTimeout(async () => {
      try { const r = await api.get<Lookup>(`/api/crm/lookup?phone=${encodeURIComponent(phone)}`); setLook(r); if (r.found) amountRef.current?.focus(); } catch (e) { setErr((e as Error).message); }
    }, 250);
    return () => clearTimeout(t);
  }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setPhone(''); setLook(null); setName(''); setConsent(false); setAmount(''); setCats([]); setReceipt(''); setDone(null); setErr(null); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      setDone(await api.post<Done>('/api/crm/checkin', { phone, firstName: name || undefined, consentSms: consent || undefined, amount: Number(amount) || 0, categories: cats, receiptNo: receipt || undefined }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const redeem = async (r: Reward) => {
    if (!done) return;
    try { await api.post(`/api/crm/customers/${done.customerId}/redeem`, { rewardKey: r.key }); setDone({ ...done, rewards: done.rewards.filter((x) => x.points <= done.profile.pointsBalance - r.points), profile: { ...done.profile, pointsBalance: done.profile.pointsBalance - r.points } }); } catch (e) { setErr((e as Error).message); }
  };
  const key = (k: string) => setPhone((p) => (k === '⌫' ? p.slice(0, -1) : k === 'C' ? '' : p.length < 16 ? p + k : p));
  const pretty = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 11)}`.trim() : digits;

  if (done) return (
    <div className="counter">
      <div className="card counter-done">
        <div className="big-check"><Icon name="check" /></div>
        <h1>{done.duplicate ? 'Already recorded' : done.profile.name === 'Guest' ? (done.created ? 'Welcome!' : 'Thank you!') : done.created ? `Welcome, ${done.profile.name}!` : `Thanks, ${done.profile.name}!`}</h1>
        {!done.duplicate && done.pointsEarned > 0 && <div className="points-big">+{done.pointsEarned} <span>points</span></div>}
        <div className="muted">{done.loyaltyName}: <b>{done.profile.pointsBalance.toLocaleString('en-PH')}</b> points <TierBadge tier={done.profile.tier} /></div>
        {done.nextReward && <div className="small muted">{done.nextReward.remaining} more to {done.nextReward.reward.name}</div>}
        {done.rewards.length > 0 && <div className="reward-ready"><b>🎁 Reward available</b><div className="row" style={{ justifyContent: 'center' }}>{done.rewards.map((r) => <button key={r.key} className="btn" onClick={() => redeem(r)}>Redeem {r.name}</button>)}</div></div>}
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <Link className="btn" to={`/admin/marketing/guests/${done.customerId}`}>Open profile</Link>
          <button className="btn primary" onClick={reset} autoFocus>Next guest</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="counter">
      <div className="page-head"><h1>Counter check-in</h1><div className="spacer" /><span className="muted small">Ask: “May I have your mobile number for points?”</span></div>
      <div className="counter-grid">
        <div className="card">
          <label className="field">Guest mobile number
            <input className="phone-input" value={pretty} inputMode="tel" placeholder="09XX XXX XXXX" onChange={(e) => setPhone(e.target.value)} autoFocus aria-label="Guest mobile number" />
          </label>
          <div className="keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => <button key={k} type="button" onClick={() => key(k)}>{k}</button>)}</div>
        </div>
        <div className="card">
          {!look && <div className="muted counter-hint"><Icon name="phone" />Type the guest's number. Returning guests are recognised instantly.</div>}
          {look && !look.valid && <div className="error">That is not a mobile number. Check the digits (e.g. 0917 123 4567).</div>}
          {look?.found && look.profile && (
            <div className="recognised">
              <div className="row"><h2 style={{ margin: 0 }}>{look.profile.name}</h2><TierBadge tier={look.profile.tier} />{look.profile.tags.includes('VIP') && <span className="tag vip">VIP</span>}</div>
              <div className="recog"><Icon name="spark" />{look.recognition}</div>
              <div className="small muted">{look.profile.pointsBalance.toLocaleString('en-PH')} points{look.nextReward ? ` · ${look.nextReward.remaining} to ${look.nextReward.reward.name}` : ''}</div>
              {look.rewards && look.rewards.length > 0 && <div className="badge good" style={{ marginTop: 6 }}>🎁 Can redeem: {look.rewards.map((r) => r.name).join(', ')}</div>}
            </div>
          )}
          {look?.valid && !look.found && (
            <div>
              <h2>New guest</h2>
              <label className="field">First name (optional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <ConsentBox checked={consent} onChange={setConsent} text={look.consentText ?? ''} />
            </div>
          )}
          {look?.valid && (
            <div style={{ marginTop: 12 }}>
              <label className="field">Bill amount (₱)<input ref={amountRef} className="amount-input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && Number(amount) > 0) void submit(); }} /></label>
              <div className="chip-pick" style={{ marginTop: 8 }}>{settings.data?.settings.categories.map((c) => <button type="button" key={c} className={cats.includes(c) ? 'on' : ''} onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])}>{c}</button>)}</div>
              <label className="field" style={{ marginTop: 8 }}>Receipt / OR no. (optional — prevents double points)<input value={receipt} onChange={(e) => setReceipt(e.target.value)} /></label>
              {err && <div className="error">{err}</div>}
              <button className="btn primary counter-go" disabled={busy || !(Number(amount) > 0)} onClick={submit}>{busy ? 'Saving…' : `Add ${amount ? peso(Number(amount)) : ''} & give points`}</button>
              {look.found && <div className="small muted" style={{ marginTop: 6 }}>Average bill {pesoShort(look.profile?.avgSpend)}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
