import { useState } from 'react';
import { api, fmtDateTime } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { TemplateEditor, type AudienceFilter } from './shared';

interface Auto { id: string; key: string; name: string; trigger: string; enabled: boolean; channel: string; days: number; filter: AudienceFilter; template: string; bonusPoints?: number; lastRunAt: string | null; dueToday: number; blockedToday: number; sent30: number }
interface Data { quiet: boolean; triggers: Record<string, string>; automations: Auto[]; preview: { automationName: string; to: string; body: string }[] }
interface Msg { id: string; createdAt: string; guestName: string; customerId: string | null; channel: string; purpose: string; body: string; status: string; provider: string; error: string | null; parts: number; cost: number; campaignName: string | null; automationKey: string | null }

const DAYS_LABEL: Record<string, string> = { welcome: 'days after the first visit', post_visit: 'days after the visit', birthday: 'days before the birthday', winback: 'days without a visit', reward_ready: 'days after the visit (max)', vip_overdue: '' };

export default function Automations() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'flows' | 'outbox'>('flows');
  const d = useApi<Data>('/api/crm/automations');
  const out = useApi<Msg[]>(tab === 'outbox' ? '/api/crm/messages' : null);
  const [edit, setEdit] = useState<Auto | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const admin = isAdmin(me?.role);
  const run = async (dryRun: boolean) => {
    const r = await api.post<{ sent: number; planned: number; skipped: number; quiet: boolean; provider: string | null }>('/api/crm/automations/run', { dryRun, force: !dryRun });
    setMsg(dryRun ? `${r.planned} message(s) due today, ${r.skipped} skipped (no consent / already messaged today)` : `Sent ${r.sent} via ${r.provider}`);
    await d.reload();
  };
  return (
    <>
      <div className="page-head">
        <h1>Automations</h1><div className="spacer" />
        <div className="tabs" style={{ margin: 0 }}><button className={tab === 'flows' ? 'active' : ''} onClick={() => setTab('flows')}>Flows</button><button className={tab === 'outbox' ? 'active' : ''} onClick={() => setTab('outbox')}>Outbox</button></div>
      </div>
      {tab === 'flows' && <>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="small muted" style={{ flex: '1 1 300px' }}>Flows run by themselves every hour (outside quiet hours). Each guest gets at most one automated message a day, and only if they gave marketing consent.</div>
          {admin && <><button className="btn" onClick={() => run(true)}>Check what is due</button><button className="btn primary" onClick={() => run(false)}>Run now</button></>}
        </div>
        {d.data?.quiet && <div className="badge warn" style={{ marginBottom: 12 }}>Quiet hours right now — the hourly run waits until morning.</div>}
        {msg && <div className="badge info" style={{ marginBottom: 12 }}>{msg}</div>}
        <div className="auto-grid">
          {d.data?.automations.map((a) => (
            <div key={a.id} className={`card auto-card ${a.enabled ? '' : 'off'}`}>
              <div className="row">
                <span className="sq"><Icon name={a.trigger === 'birthday' ? 'cake' : a.trigger === 'reward_ready' ? 'gift' : a.trigger === 'winback' || a.trigger === 'vip_overdue' ? 'repeat' : 'send'} /></span>
                <div style={{ flex: 1 }}><b>{a.name}</b><div className="small muted">{d.data!.triggers[a.trigger]}{a.days && DAYS_LABEL[a.trigger] ? ` · ${a.days} ${a.days === 1 ? DAYS_LABEL[a.trigger].replace('days', 'day') : DAYS_LABEL[a.trigger]}` : ''}{a.bonusPoints ? ` · +${a.bonusPoints} pts` : ''}</div></div>
                {admin ? <button className={`toggle ${a.enabled ? 'on' : ''}`} role="switch" aria-checked={a.enabled} aria-label={`${a.name} ${a.enabled ? 'on' : 'off'}`} onClick={async () => { await api.patch(`/api/crm/automations/${a.id}`, { enabled: !a.enabled }); await d.reload(); }}><i /></button> : <span className="badge">{a.enabled ? 'On' : 'Off'}</span>}
              </div>
              <div className="sms-bubble">{a.template}</div>
              <div className="row small muted">
                <span>{a.enabled ? `${a.dueToday} due today` : 'off'}{a.blockedToday ? ` · ${a.blockedToday} without consent` : ''} · {a.sent30} sent in 30 days</span>
                <div className="spacer" />{admin && <button className="btn sm" onClick={() => setEdit(a)}>Edit</button>}
              </div>
            </div>
          ))}
        </div>
        {d.data && d.data.preview.length > 0 && <div className="card" style={{ marginTop: 14 }}>
          <h2>Next messages</h2>
          {d.data.preview.map((p, i) => <div key={i} className="kv-row"><span className="small">{p.automationName}</span><b className="small" style={{ fontWeight: 500, maxWidth: '70%' }}>{p.body}</b></div>)}
        </div>}
      </>}
      {tab === 'outbox' && (
        <div className="card table-wrap">
          <table><thead><tr><th>When</th><th>Guest</th><th>From</th><th>Message</th><th>Status</th><th className="num">Cost</th></tr></thead>
            <tbody>{out.data?.map((m) => (
              <tr key={m.id}><td className="small">{fmtDateTime(m.createdAt)}</td><td>{m.guestName}</td><td className="small">{m.campaignName ?? (m.automationKey ? `auto: ${m.automationKey}` : 'one-off')}</td>
                <td className="wrap-cell small">{m.body}</td><td><span className={`badge ${m.status === 'failed' ? 'bad' : m.status === 'sent' ? 'good' : ''}`} title={m.error ?? m.provider}>{m.status}</span></td><td className="num">₱{m.cost.toFixed(2)}</td></tr>
            ))}</tbody></table>
        </div>
      )}
      {edit && <EditAuto a={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await d.reload(); }} />}
    </>
  );
}

function EditAuto({ a, onClose, onSaved }: { a: Auto; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: a.name, template: a.template, days: a.days, bonusPoints: a.bonusPoints ?? 0 });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Edit: ${a.name}`} onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { try { await api.patch(`/api/crm/automations/${a.id}`, { name: f.name, template: f.template, days: f.days, bonusPoints: f.bonusPoints || null }); onSaved(); } catch (e) { setErr((e as Error).message); } }}>Save</button></>}>
      <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      {DAYS_LABEL[a.trigger] && <label className="field" style={{ marginTop: 8 }}>Timing: {DAYS_LABEL[a.trigger]}<input type="number" min={0} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} /></label>}
      <label className="field" style={{ marginTop: 8 }}>Bonus points with the message<input type="number" min={0} value={f.bonusPoints} onChange={(e) => setF({ ...f, bonusPoints: Number(e.target.value) })} /></label>
      <div style={{ marginTop: 8 }}><TemplateEditor value={f.template} onChange={(template) => setF({ ...f, template })} /></div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}
