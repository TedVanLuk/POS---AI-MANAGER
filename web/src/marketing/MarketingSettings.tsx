import { useEffect, useState } from 'react';
import { api } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { ConfirmDialog } from '../components/Modal';
import type { Reward } from './shared';

interface Tier { name: string; minSpend365: number; multiplier: number; perks: string }
interface TagRule { tag: string; description: string; when: { field: string; op: string; value: number }[] }
interface CrmSettings {
  businessType: string; playbook: string | null; senderName: string; categories: string[]; consentText: string; consentVersion: string;
  quietHours: { start: number; end: number }; holdoutPct: number; attributionDays: number; dayStartHour: number; costPerSms: number; retentionDays: number;
  loyalty: { enabled: boolean; name: string; earn: { kind: 'spend'; pesosPerPoint: number } | { kind: 'visit'; points: number; minSpend: number }; rewards: Reward[]; welcomePoints: number; birthdayPoints: number; expiryDays: number | null };
  tiers: Tier[]; tagRules: TagRule[];
}
interface Data { settings: CrmSettings; business: string; provider: string; playbooks: { key: string; name: string; summary: string; businessTypes: string[]; automations: number }[] }

export default function MarketingSettings() {
  const { me } = useAuth();
  const d = useApi<Data>('/api/crm/settings');
  const [s, setS] = useState<CrmSettings | null>(null);
  const [apply, setApply] = useState<Data['playbooks'][number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (d.data) setS(structuredClone(d.data.settings)); }, [d.data]);
  if (!d.data || !s) return <div className="muted">Loading…</div>;
  const admin = isAdmin(me?.role);
  const save = async () => {
    setErr(null);
    try {
      const { senderName, consentText, holdoutPct, attributionDays, quietHours, dayStartHour, costPerSms, retentionDays, categories, loyalty, tiers } = s;
      await api.put('/api/crm/settings', { senderName, consentText, holdoutPct, attributionDays, quietHours, dayStartHour, costPerSms, retentionDays, categories, loyalty, tiers });
      setMsg('Saved'); await d.reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const L = s.loyalty;
  const setL = (patch: Partial<CrmSettings['loyalty']>) => setS({ ...s, loyalty: { ...L, ...patch } });
  const n = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <>
      <div className="page-head"><h1>Marketing settings</h1><div className="spacer" />{msg && <span className="badge good">{msg}</span>}{admin && <button className="btn primary" onClick={save}>Save changes</button>}</div>
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="card">
        <h2>Playbooks</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>A playbook sets up the loyalty program, tiers, auto-tags and automations for your type of venue in one click. Your sender name, privacy and measurement settings are kept.</div>
        <div className="grid cols-2">
          {d.data.playbooks.map((p) => (
            <div key={p.key} className={`playbook ${s.playbook === p.key ? 'on' : ''}`}>
              <div className="row"><b>{p.name}</b><div className="spacer" />{s.playbook === p.key ? <span className="badge good">Active</span> : admin && <button className="btn sm" onClick={() => setApply(p)}>Apply</button>}</div>
              <div className="small">{p.summary}</div>
              <div className="small muted">{p.automations} automations · for {p.businessTypes.join(', ')}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mk-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="row"><h2 style={{ margin: 0 }}>Loyalty program</h2><div className="spacer" /><label className="row small"><input type="checkbox" checked={L.enabled} onChange={(e) => setL({ enabled: e.target.checked })} /> enabled</label></div>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="field">Name<input value={L.name} onChange={(e) => setL({ name: e.target.value })} /></label>
            <label className="field">Guests earn<select value={L.earn.kind} onChange={(e) => setL({ earn: e.target.value === 'spend' ? { kind: 'spend', pesosPerPoint: 100 } : { kind: 'visit', points: 1, minSpend: 150 } })}><option value="spend">points per ₱ spent</option><option value="visit">a stamp per visit</option></select></label>
            {L.earn.kind === 'spend'
              ? <label className="field">1 point for every ₱<input type="number" min={1} value={L.earn.pesosPerPoint} onChange={(e) => setL({ earn: { kind: 'spend', pesosPerPoint: n(e.target.value) } })} /></label>
              : <><label className="field">Stamps per visit<input type="number" min={1} value={L.earn.points} onChange={(e) => setL({ earn: { ...L.earn as { kind: 'visit'; points: number; minSpend: number }, points: n(e.target.value) } })} /></label>
                <label className="field">Minimum bill (₱)<input type="number" min={0} value={L.earn.minSpend} onChange={(e) => setL({ earn: { ...L.earn as { kind: 'visit'; points: number; minSpend: number }, minSpend: n(e.target.value) } })} /></label></>}
            <label className="field">Welcome points<input type="number" min={0} value={L.welcomePoints} onChange={(e) => setL({ welcomePoints: n(e.target.value) })} /></label>
            <label className="field">Points expire after (days, empty = never)<input type="number" min={30} value={L.expiryDays ?? ''} onChange={(e) => setL({ expiryDays: e.target.value === '' ? null : n(e.target.value) })} /></label>
          </div>
          <h3 style={{ marginTop: 12 }}>Rewards</h3>
          <table><thead><tr><th>Reward</th><th className="num">Points</th><th className="num">Worth ₱</th><th /></tr></thead>
            <tbody>{L.rewards.map((r, i) => (
              <tr key={i}><td><input value={r.name} onChange={(e) => setL({ rewards: L.rewards.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></td>
                <td className="num"><input type="number" style={{ width: 90 }} value={r.points} onChange={(e) => setL({ rewards: L.rewards.map((x, j) => (j === i ? { ...x, points: n(e.target.value) } : x)) })} /></td>
                <td className="num"><input type="number" style={{ width: 100 }} value={r.value} onChange={(e) => setL({ rewards: L.rewards.map((x, j) => (j === i ? { ...x, value: n(e.target.value) } : x)) })} /></td>
                <td><button className="btn sm" onClick={() => setL({ rewards: L.rewards.filter((_, j) => j !== i) })}>✕</button></td></tr>
            ))}</tbody></table>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setL({ rewards: [...L.rewards, { key: `reward_${L.rewards.length + 1}`, name: 'New reward', points: 100, kind: 'free_item', value: 500 }] })}>+ Reward</button>
          <div className="small muted" style={{ marginTop: 8 }}>Effective give-back: {L.earn.kind === 'spend' && L.rewards[0] ? `about ${((L.rewards[0].value / (L.rewards[0].points * L.earn.pesosPerPoint)) * 100).toFixed(1)}% of spend on “${L.rewards[0].name}”` : 'depends on visit frequency'}.</div>
        </div>

        <div className="card">
          <h2>Tiers (by spend in the last 12 months)</h2>
          <table><thead><tr><th>Tier</th><th className="num">From ₱</th><th className="num">Points ×</th><th>Perks</th></tr></thead>
            <tbody>{s.tiers.map((t, i) => (
              <tr key={i}><td><input style={{ width: 110 }} value={t.name} onChange={(e) => setS({ ...s, tiers: s.tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></td>
                <td className="num"><input type="number" style={{ width: 110 }} value={t.minSpend365} onChange={(e) => setS({ ...s, tiers: s.tiers.map((x, j) => (j === i ? { ...x, minSpend365: n(e.target.value) } : x)) })} /></td>
                <td className="num"><input type="number" step={0.25} style={{ width: 70 }} value={t.multiplier} onChange={(e) => setS({ ...s, tiers: s.tiers.map((x, j) => (j === i ? { ...x, multiplier: n(e.target.value) } : x)) })} /></td>
                <td><input value={t.perks} onChange={(e) => setS({ ...s, tiers: s.tiers.map((x, j) => (j === i ? { ...x, perks: e.target.value } : x)) })} /></td></tr>
            ))}</tbody></table>
          <h3 style={{ marginTop: 14 }}>Auto-tags</h3>
          {s.tagRules.map((r) => <div key={r.tag} className="kv-row"><span><span className={`tag ${r.tag === 'VIP' ? 'vip' : ''}`}>{r.tag}</span></span><b className="small" style={{ fontWeight: 500 }}>{r.description}</b></div>)}
          <h3 style={{ marginTop: 14 }}>Purchase categories</h3>
          <input value={s.categories.join(', ')} onChange={(e) => setS({ ...s, categories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} style={{ width: '100%' }} />
        </div>
      </div>

      <div className="mk-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Messaging & privacy (Data Privacy Act)</h2>
          <div className="form-grid">
            <label className="field">SMS sender name (NTC-registered, max 11)<input maxLength={11} value={s.senderName} onChange={(e) => setS({ ...s, senderName: e.target.value })} /></label>
            <label className="field">Quiet hours from<input type="number" min={0} max={23} value={s.quietHours.start} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, start: n(e.target.value) } })} /></label>
            <label className="field">…until<input type="number" min={0} max={23} value={s.quietHours.end} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, end: n(e.target.value) } })} /></label>
            <label className="field">Cost per SMS part (₱)<input type="number" step={0.01} min={0} value={s.costPerSms} onChange={(e) => setS({ ...s, costPerSms: n(e.target.value) })} /></label>
            <label className="field">Review inactive profiles after (days)<input type="number" min={90} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: n(e.target.value) })} /></label>
          </div>
          <label className="field" style={{ marginTop: 10 }}>Consent wording read to guests (version {s.consentVersion} — changing it creates a new version)<textarea value={s.consentText} onChange={(e) => setS({ ...s, consentText: e.target.value })} /></label>
          <div className="small muted">Provider: <b>{d.data.provider === 'log' ? 'simulated (log only — nothing is sent)' : d.data.provider}</b>. Marketing goes only to guests with a recorded opt-in; every message ends with “Reply STOP to opt out”, and STOP replies switch consent off automatically.</div>
        </div>
        <div className="card">
          <h2>Measurement</h2>
          <div className="form-grid">
            <label className="field">Default holdout (%)<input type="number" min={0} max={50} value={s.holdoutPct} onChange={(e) => setS({ ...s, holdoutPct: n(e.target.value) })} /></label>
            <label className="field">Count a return within (days)<input type="number" min={1} max={90} value={s.attributionDays} onChange={(e) => setS({ ...s, attributionDays: n(e.target.value) })} /></label>
            <label className="field">Business day starts at (hour)<input type="number" min={0} max={12} value={s.dayStartHour} onChange={(e) => setS({ ...s, dayStartHour: n(e.target.value) })} /></label>
          </div>
          <h2 style={{ marginTop: 16 }}>Connect your POS</h2>
          <div className="small">Any POS can send closed bills with the guest's mobile; the guest is found or created, points are added, and a repeated receipt number is ignored. Authenticate with a device token from <b>Settings → Devices</b>.</div>
          <pre className="code-block">{`POST /api/crm/pos/transactions
X-Device-Token: <device token>
{ "receiptNo": "OR-104233", "amount": 4850,
  "phone": "0917 123 4567", "categories": ["bottle"],
  "occurredAt": "2026-11-20T23:41:00+08:00" }`}</pre>
          <div className="small muted">Bills without a phone number are ignored (anonymous). Bulk guest lists can be imported via <code>POST /api/crm/import</code> — consent is only imported together with a description of how it was collected.</div>
        </div>
      </div>

      {apply && <ConfirmDialog title={`Apply “${apply.name}”?`} confirmLabel="Apply playbook"
        message={<>This replaces the loyalty program, tiers, auto-tags, categories and <b>all automations</b> with the playbook's. Guests, points and history are not touched.</>}
        onClose={() => setApply(null)} onConfirm={async () => { await api.post(`/api/crm/playbooks/${apply.key}/apply`); setMsg(`${apply.name} applied`); await d.reload(); }} />}
    </>
  );
}
