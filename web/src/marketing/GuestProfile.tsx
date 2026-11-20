import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDateTime, peso } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Icon, Portrait } from '../components/Icon';
import { ConfirmDialog, Modal, ReasonDialog } from '../components/Modal';
import { Bars, fmtK } from '../crm/charts';
import { ago, pesoShort, SEGMENT_LABEL, SegmentBadge, Tags, TierBadge, type Consent, type Reward, type Segment } from './shared';

interface Prefs { drinks?: string; food?: string; seating?: string; allergies?: string; music?: string; notes?: string }
interface Detail {
  profile: {
    id: string; name: string; firstName: string; lastName: string; phone: string | null; phoneDisplay: string; email: string | null; birthday: string | null; source: string;
    preferences: Prefs; consent: Partial<Record<'sms' | 'viber' | 'email', Consent>>; erasedAt: string | null; createdAt: string;
    stats: { visits: number; visits90: number; spend: number; spend365: number; avgSpend: number; maxSpend: number; firstVisit: string | null; lastVisit: string | null; daysSinceLastVisit: number | null; avgGapDays: number | null; overdue: boolean; categories: Record<string, number> };
    rfm: { r: number; f: number; m: number }; segment: Segment; tier: string | null; multiplier: number; nextTier: { tier: { name: string }; remaining: number } | null;
    manualTags: string[]; autoTags: string[]; tags: string[]; pointsBalance: number; nextReward: { reward: Reward; remaining: number } | null; rewards: Reward[];
    bookings: number; noShows: number; daysToBirthday: number | null; marketable: { sms: boolean; viber: boolean; email: boolean };
  };
  recognition: string;
  settings: { loyalty: { name: string; rewards: Reward[] }; tiers: { name: string; minSpend365: number; perks: string }[]; consentText: string; categories: string[] };
  referredBy: { id: string; name: string } | null;
  visits: { id: string; occurredAt: string; date: string; amount: number; categories: string[]; source: string; pointsEarned: number; serverName: string | null; note?: string | null }[];
  points: { id: string; kind: string; points: number; note: string | null; date: string }[];
  reservations: { id: string; date: string; arrivalTime: string | null; partySize: number; tableArea: string | null; minSpend: number; status: string; actualSpend: number | null; hostName: string | null; promoterName: string | null }[];
  messages: { id: string; createdAt: string; body: string; status: string; channel: string; campaignId: string | null; automationKey: string | null }[];
  consentEvents: { id: string; channel: string; granted: boolean; source: string; textVersion: string | null; text: string | null; createdAt: string }[];
}

export default function GuestProfile() {
  const { id } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const d = useApi<Detail>(`/api/crm/customers/${id}`);
  const [tab, setTab] = useState<'timeline' | 'points' | 'messages' | 'privacy'>('timeline');
  const [edit, setEdit] = useState(false);
  const [visit, setVisit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [erase, setErase] = useState(false);
  const [redeem, setRedeem] = useState<Reward | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (d.error) return <div className="error">{d.error}</div>;
  if (!d.data) return <div className="muted">Loading…</div>;
  const { profile: p, settings } = d.data;
  const s = p.stats;
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3000); };
  const nextPct = p.nextReward ? Math.round((p.pointsBalance / p.nextReward.reward.points) * 100) : 100;
  const topCats = Object.entries(s.categories).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const exportData = async () => {
    const data = await api.get<unknown>(`/api/crm/customers/${p.id}/export`);
    try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); flash('Guest data copied as JSON — paste it into an email or file for the guest'); } catch { flash('The browser blocked copying'); }
  };

  if (p.erasedAt) return (
    <div className="card"><h1>Erased guest</h1><div className="muted">Personal data was erased on {fmtDateTime(p.erasedAt)} at the guest's request. {s.visits} anonymous visits ({peso(s.spend)}) are kept for the books.</div>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => nav('/crm/customers')}>Back to guests</button></div>
  );

  return (
    <>
      <div className="page-head">
        <Link to="/crm/customers" className="icon-btn" aria-label="Back to guests"><Icon name="left" /></Link>
        <h1>{p.name}</h1><TierBadge tier={p.tier} /><SegmentBadge s={p.segment} />
        <div className="spacer" />
        <button className="btn" onClick={() => setEdit(true)}>Edit profile</button>
        <button className="btn primary" onClick={() => setVisit(true)}>+ Add purchase</button>
      </div>

      <div className="guest-hero card">
        <Portrait name={p.name} className="guest-portrait" />
        <div>
          <div className="recog"><Icon name="spark" />{d.data.recognition}</div>
          <div className="row" style={{ marginTop: 8 }}><Tags tags={p.tags} max={12} /></div>
          <div className="guest-facts">
            <span><Icon name="phone" />{p.phoneDisplay}</span>
            {p.email && <span><Icon name="mail" />{p.email}</span>}
            {p.birthday && <span>🎂 {new Date(`2000-${p.birthday}T12:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric' })}{p.daysToBirthday !== null && p.daysToBirthday <= 30 ? ` · in ${p.daysToBirthday} days` : ''}</span>}
            <span>Since {new Date(p.createdAt).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })} · via {p.source}</span>
            {d.data.referredBy && <span>Brought by <b>{d.data.referredBy.name}</b></span>}
          </div>
        </div>
        <div className="pref-box">
          <h3>Preferences</h3>
          {(['drinks', 'food', 'seating', 'music', 'allergies', 'notes'] as const).filter((k) => p.preferences[k]).map((k) => <div key={k} className={`kv-row ${k === 'allergies' ? 'bad-text' : ''}`}><span>{k}</span><b>{p.preferences[k]}</b></div>)}
          {!Object.values(p.preferences).some(Boolean) && <div className="muted small">Nothing noted yet. Favourite drink, table, allergies… staff see this at the door.</div>}
        </div>
      </div>

      <div className="d-tiles mk-tiles">
        <div className="tile"><div className="v">{pesoShort(s.spend365)}</div><div className="k">Spend, last 12 months · lifetime {pesoShort(s.spend)}</div></div>
        <div className="tile"><div className="v">{s.visits}</div><div className="k">Visits · {s.visits90} in 90 days{s.avgGapDays ? ` · every ~${Math.round(s.avgGapDays)} days` : ''}</div></div>
        <div className="tile"><div className="v">{pesoShort(s.avgSpend)}</div><div className="k">Average per visit · best {pesoShort(s.maxSpend)}</div></div>
        <div className="tile"><div className="v">{ago(s.daysSinceLastVisit)}</div><div className="k">Last visit{s.overdue ? ' · overdue vs usual rhythm' : ''}</div></div>
        <div className="tile"><div className="v">{p.bookings}</div><div className="k">Reservations · {p.noShows} no-show{p.noShows === 1 ? '' : 's'}</div></div>
      </div>

      {d.data.visits.length > 1 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head"><h2>Spending per visit</h2><div className="spacer" /><span className="small">last {Math.min(40, d.data.visits.length)} visits · lifetime {fmtK(s.spend)}</span></div>
          <Bars label="Hover a visit" height={150} data={[...d.data.visits].slice(0, 40).reverse().map((v) => ({ key: v.id, label: new Date(`${v.date}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), value: v.amount }))} />
        </div>
      )}

      <div className="mk-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-head"><h2>{settings.loyalty.name}</h2><div className="spacer" />{isAdmin(me?.role) && <button className="btn sm" onClick={() => setAdjust(true)}>Adjust</button>}</div>
          <div className="points-big">{p.pointsBalance.toLocaleString('en-PH')} <span>points{p.multiplier > 1 ? ` · earning ×${p.multiplier}` : ''}</span></div>
          {p.nextReward && <><div className="mini-bar" style={{ height: 8 }}><i style={{ width: `${nextPct}%` }} /></div><div className="small muted" style={{ marginTop: 4 }}>{p.nextReward.remaining} more points to <b>{p.nextReward.reward.name}</b></div></>}
          {p.rewards.length > 0 && <div className="reward-list">{p.rewards.map((r) => <button key={r.key} className="btn sm" onClick={() => setRedeem(r)}>Redeem: {r.name} ({r.points})</button>)}</div>}
          <div className="kv-row" style={{ marginTop: 10 }}><span>Tier</span><b>{p.tier ?? '—'}{p.nextTier ? ` · ${pesoShort(p.nextTier.remaining)} to ${p.nextTier.tier.name}` : ''}</b></div>
          <div className="kv-row"><span>Perks</span><b className="small" style={{ fontWeight: 500 }}>{settings.tiers.find((t) => t.name === p.tier)?.perks ?? '—'}</b></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>What they buy</h2><div className="spacer" /><span className="small">R{p.rfm.r} · F{p.rfm.f} · M{p.rfm.m}</span></div>
          {topCats.length === 0 && <div className="muted small">No purchases with categories yet.</div>}
          {topCats.map(([c, n]) => <div key={c} className="eff-row"><span>{c}</span><div className="mini-bar"><i style={{ width: `${Math.round((n / Math.max(1, s.visits)) * 100)}%` }} /></div><b>{Math.round((n / Math.max(1, s.visits)) * 100)}%</b></div>)}
          <div className="small muted" style={{ marginTop: 8 }}>{SEGMENT_LABEL[p.segment]}: share of visits that included each category. Auto-tags: {p.autoTags.join(', ') || 'none'}.</div>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 16 }}>
        {(['timeline', 'points', 'messages', 'privacy'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ timeline: 'Visits & tables', points: 'Points ledger', messages: 'Messages', privacy: 'Consent & privacy' }[t]}</button>)}
      </div>

      {tab === 'timeline' && (
        <div className="grid">
          <div className="card table-wrap">
            <h2>Visits</h2>
            <table><thead><tr><th>Date</th><th>Bought</th><th>Served by</th><th className="num">Amount</th><th className="num">Points</th></tr></thead>
              <tbody>{d.data.visits.map((v) => <tr key={v.id}><td>{v.date}</td><td className="small">{v.categories.join(', ') || '—'}{v.note ? <span className="muted"> · {v.note}</span> : null}</td><td className="small">{v.serverName ?? '—'}</td><td className="num">{peso(v.amount)}</td><td className="num">{v.pointsEarned ? `+${v.pointsEarned}` : ''}</td></tr>)}
                {!d.data.visits.length && <tr><td colSpan={5} className="muted">No visits yet.</td></tr>}</tbody></table>
          </div>
          <div className="card table-wrap">
            <h2>Reservations</h2>
            <table><thead><tr><th>Date</th><th>Table</th><th>Host / promoter</th><th className="num">Min.</th><th className="num">Spent</th><th>Status</th></tr></thead>
              <tbody>{d.data.reservations.map((r) => <tr key={r.id}><td>{r.date}</td><td className="small">{r.tableArea ?? '—'} · {r.partySize} pax</td><td className="small">{[r.hostName, r.promoterName].filter(Boolean).join(' / ') || '—'}</td><td className="num">{pesoShort(r.minSpend)}</td><td className="num">{r.actualSpend ? pesoShort(r.actualSpend) : '—'}</td><td><span className={`badge ${r.status === 'no_show' ? 'bad' : r.status === 'completed' ? 'good' : ''}`}>{r.status.replace('_', '-')}</span></td></tr>)}
                {!d.data.reservations.length && <tr><td colSpan={6} className="muted">No reservations.</td></tr>}</tbody></table>
          </div>
        </div>
      )}
      {tab === 'points' && (
        <div className="card table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Note</th><th className="num">Points</th></tr></thead>
          <tbody>{d.data.points.map((x) => <tr key={x.id}><td>{x.date}</td><td>{x.kind}</td><td className="small">{x.note ?? ''}</td><td className={`num ${x.points < 0 ? 'bad-text' : 'good-text'}`}>{x.points > 0 ? '+' : ''}{x.points}</td></tr>)}</tbody></table></div>
      )}
      {tab === 'messages' && (
        <div className="card">
          {!d.data.messages.length && <div className="muted">No messages sent to this guest.</div>}
          <div className="timeline">{d.data.messages.map((m) => (
            <div key={m.id} className="tl-row"><span className="tl-dot"><Icon name="send" /></span><span><span className="t">{m.body}</span><br /><span className="s">{m.channel.toUpperCase()} · {m.automationKey ? `automation: ${m.automationKey}` : m.campaignId ? 'campaign' : 'one-off'} · {m.status}</span></span><time>{fmtDateTime(m.createdAt)}</time></div>
          ))}</div>
        </div>
      )}
      {tab === 'privacy' && (
        <div className="mk-grid">
          <div className="card">
            <h2>Marketing consent</h2>
            <div className="small muted" style={{ marginBottom: 10 }}>Data Privacy Act: marketing needs an opt-in the guest gave (not a pre-ticked box). Booking confirmations and points balance are allowed without it. A STOP reply switches SMS off automatically.</div>
            {(['sms', 'viber', 'email'] as const).map((ch) => {
              const c = p.consent[ch];
              return (
                <div key={ch} className="kv-row" style={{ alignItems: 'center' }}>
                  <span>{ch.toUpperCase()} {c ? <span className="small muted">· {c.granted ? 'opted in' : 'opted out'} {fmtDateTime(c.at)} via {c.source}</span> : <span className="small muted">· never asked</span>}</span>
                  <button className="btn sm" onClick={async () => { await api.post(`/api/crm/customers/${p.id}/consent`, { channel: ch, granted: !c?.granted, source: 'admin' }); await d.reload(); flash(c?.granted ? 'Consent withdrawn' : 'Consent recorded'); }}>{c?.granted ? 'Withdraw' : 'Record opt-in'}</button>
                </div>
              );
            })}
            <h3 style={{ marginTop: 14 }}>Consent history (proof)</h3>
            <div className="timeline">{d.data.consentEvents.map((e) => (
              <div key={e.id} className="tl-row"><span className={`tl-dot ${e.granted ? 'in' : ''}`}><Icon name={e.granted ? 'check' : 'minus'} /></span><span><span className="t">{e.channel.toUpperCase()} {e.granted ? 'opt-in' : 'opt-out'} · {e.source}{e.textVersion ? ` · wording ${e.textVersion}` : ''}</span>{e.text && <><br /><span className="s">“{e.text}”</span></>}</span><time>{fmtDateTime(e.createdAt)}</time></div>
            ))}</div>
          </div>
          <div className="card">
            <h2>Data subject rights</h2>
            <div className="small muted" style={{ marginBottom: 10 }}>Guests can ask what you hold about them (access), take a copy (portability), or ask you to delete it (erasure). Answer without undue delay.</div>
            {isAdmin(me?.role) ? <div className="row">
              <button className="btn" onClick={exportData}><Icon name="download" /> Copy guest data (JSON)</button>
              <button className="btn danger" onClick={() => setErase(true)}>Erase personal data…</button>
            </div> : <div className="muted small">Ask an owner/admin to export or erase.</div>}
          </div>
        </div>
      )}

      {edit && <EditGuest d={d.data} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await d.reload(); flash('Profile saved'); }} />}
      {visit && <AddVisit id={p.id} categories={settings.categories} onClose={() => setVisit(false)} onSaved={async (pts) => { setVisit(false); await d.reload(); flash(`Purchase added · +${pts} points`); }} />}
      {redeem && <ConfirmDialog title={`Redeem ${redeem.name}?`} message={<>This uses <b>{redeem.points}</b> of {p.firstName}'s {p.pointsBalance} points. Give the reward now.</>} confirmLabel="Redeem" onClose={() => setRedeem(null)}
        onConfirm={async () => { await api.post(`/api/crm/customers/${p.id}/redeem`, { rewardKey: redeem.key }); await d.reload(); flash(`${redeem.name} redeemed`); }} />}
      {adjust && <AdjustPoints id={p.id} onClose={() => setAdjust(false)} onSaved={async () => { await d.reload(); flash('Points adjusted'); }} />}
      {erase && <ReasonDialog title="Erase this guest's personal data?" confirmLabel="Erase permanently" description={<>Name, mobile, email, birthday, preferences, tags and message texts are deleted and cannot be recovered. Sales amounts stay as anonymous history. Export first if the guest asked for a copy.</>}
        onClose={() => setErase(false)} onConfirm={async (reason) => { await api.post(`/api/crm/customers/${p.id}/erase`, { reason }); await d.reload(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function EditGuest({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: () => void }) {
  const p = d.profile;
  const emps = useApi<{ id: string; firstName: string; lastName: string; department: string | null; active: boolean }[]>('/api/employees');
  const [f, setF] = useState({ firstName: p.firstName, lastName: p.lastName, phone: p.phoneDisplay === '—' ? '' : p.phoneDisplay, email: p.email ?? '', birthday: p.birthday ?? '', tags: p.manualTags.join(', '), referredByEmployeeId: d.referredBy?.id ?? '', ...p.preferences });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.patch(`/api/crm/customers/${p.id}`, {
        firstName: f.firstName, lastName: f.lastName, phone: f.phone || null, email: f.email || null, birthday: f.birthday || null, referredByEmployeeId: f.referredByEmployeeId || null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
        preferences: Object.fromEntries((['drinks', 'food', 'seating', 'music', 'allergies', 'notes'] as const).map((k) => [k, (f as Prefs)[k] ?? '']).filter(([, v]) => v)),
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  const field = (k: keyof typeof f, label: string, ph = '') => <label className="field">{label}<input value={(f[k] as string) ?? ''} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Modal title="Edit guest" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        {field('firstName', 'First name')}{field('lastName', 'Last name')}{field('phone', 'Mobile', '0917 123 4567')}{field('email', 'Email')}{field('birthday', 'Birthday (MM-DD)', '07-24')}
        <label className="field">Brought by (promoter / host)<select value={f.referredByEmployeeId} onChange={(e) => setF({ ...f, referredByEmployeeId: e.target.value })}><option value="">—</option>{emps.data?.filter((e) => e.active && ['Promoters', 'VIP Host', 'Supervisors'].includes(e.department ?? '')).map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.department}</option>)}</select></label>
      </div>
      <h3 style={{ marginTop: 12 }}>Preferences</h3>
      <div className="form-grid">{field('drinks', 'Drinks', 'Hennessy VSOP, no ice')}{field('food', 'Food')}{field('seating', 'Table / seat', 'Ultra VIP')}{field('music', 'Music')}{field('allergies', 'Allergies')}</div>
      <label className="field" style={{ marginTop: 8 }}>Notes<textarea value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <label className="field" style={{ marginTop: 8 }}>Manual tags (comma separated)<input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="Celebrity, Corporate" /></label>
      <div className="small muted">Auto-tags ({p.autoTags.join(', ') || 'none'}) are computed from behaviour and cannot be edited here.</div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function AddVisit({ id, categories, onClose, onSaved }: { id: string; categories: string[]; onClose: () => void; onSaved: (points: number) => void }) {
  const [amount, setAmount] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { const r = await api.post<{ pointsEarned: number }>(`/api/crm/customers/${id}/visits`, { amount: Number(amount), categories: cats, note: note || undefined }); onSaved(r.pointsEarned); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="Add purchase" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!(Number(amount) > 0)} onClick={save}>Save</button></>}>
      <label className="field">Bill amount (₱)<input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      <div className="chip-pick" style={{ marginTop: 10 }}>{categories.map((c) => <button type="button" key={c} className={cats.includes(c) ? 'on' : ''} onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])}>{c}</button>)}</div>
      <label className="field" style={{ marginTop: 10 }}>Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function AdjustPoints({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [pts, setPts] = useState('');
  return (
    <ReasonDialog title="Adjust points" confirmLabel="Adjust" onClose={onClose} onConfirm={async (reason) => { await api.post(`/api/crm/customers/${id}/points`, { points: Number(pts), reason }); onSaved(); }}>
      <label className="field">Points (+ to add, − to remove)<input type="number" value={pts} onChange={(e) => setPts(e.target.value)} autoFocus /></label>
    </ReasonDialog>
  );
}
