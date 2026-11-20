import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDateTime } from '../api';
import { isAdmin, useAuth } from '../auth';
import { useApi } from '../hooks';
import { ConfirmDialog } from '../components/Modal';
import { AudienceEditor, LiftCard, SEGMENT_LABEL, TemplateEditor, type AudienceFilter, type Lift, type Segment } from './shared';

interface Campaign { id: string; name: string; channel: string; template: string; filter: AudienceFilter; holdoutPct: number; status: 'draft' | 'sent'; sentAt: string | null; holdout: number; messages: number; attributionDays: number; createdAt: string; result: Lift | null }
interface Preview { matched: number; eligible: number; excluded: Record<string, number>; holdout: number; toSend: number; parts: number; estCost: number; samples: { body: string }[]; quiet: boolean }
interface Settings { settings: { tiers: { name: string }[]; categories: string[]; holdoutPct: number; attributionDays: number }; provider: string }

const IDEAS: { name: string; filter: AudienceFilter; template: string }[] = [
  { name: 'Win back lapsed regulars', filter: { segments: ['at_risk', 'cant_lose'] }, template: 'Hi {{firstName}}, we miss you! Your table is waiting — free entry for 2 this week. You have {{points}} points.' },
  { name: 'Birthday month invite', filter: { birthdayWithinDays: 30 }, template: 'Hi {{firstName}}, your birthday is coming! Celebrate with us — reply BOOK and we prepare a surprise for your table.' },
  { name: 'Fill a quiet Wednesday', filter: { segments: ['loyal', 'champion', 'promising'] }, template: 'Hi {{firstName}}, this Wednesday only: double points all night. See you!' },
  { name: 'Second-visit push', filter: { segments: ['new'] }, template: 'Hi {{firstName}}, thanks for your first visit! Come back within 14 days for 2x points.' },
];

export default function Campaigns() {
  const { me } = useAuth();
  const [sp, setSp] = useSearchParams();
  const list = useApi<Campaign[]>('/api/crm/campaigns');
  const settings = useApi<Settings>('/api/crm/settings');
  const tags = useApi<{ tags: string[] }>('/api/crm/customers?q=__none__');
  const preset = sp.get('segment') as Segment | null;
  const [draft, setDraft] = useState<{ name: string; template: string; filter: AudienceFilter; holdoutPct: number } | null>(
    preset ? { name: `Message: ${SEGMENT_LABEL[preset]}`, template: 'Hi {{firstName}}, ', filter: { segments: [preset] }, holdoutPct: 10 } : sp.get('new') ? { name: '', template: 'Hi {{firstName}}, ', filter: {}, holdoutPct: 10 } : null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sending, setSending] = useState<Campaign | null>(null);
  const [forceQuiet, setForceQuiet] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) { setPreview(null); return; }
    const t = setTimeout(async () => { try { setPreview(await api.post<Preview>('/api/crm/campaigns/preview', { filter: draft.filter, channel: 'sms', template: draft.template, holdoutPct: draft.holdoutPct })); } catch (e) { setErr((e as Error).message); } }, 300);
    return () => clearTimeout(t);
  }, [draft]);

  const saveDraft = async () => {
    if (!draft) return;
    setErr(null);
    try {
      await api.post('/api/crm/campaigns', { name: draft.name || 'Untitled campaign', template: draft.template, filter: draft.filter, holdoutPct: draft.holdoutPct, channel: 'sms' });
      setDraft(null); setSp({}, { replace: true }); await list.reload(); setMsg('Draft saved — review it below and press Send.');
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="page-head">
        <h1>Campaigns</h1><div className="spacer" />
        {!draft && <button className="btn primary" onClick={() => setDraft({ name: '', template: 'Hi {{firstName}}, ', filter: {}, holdoutPct: settings.data?.settings.holdoutPct ?? 10 })}>+ New campaign</button>}
      </div>
      {settings.data?.provider === 'log' && <div className="notice" style={{ marginBottom: 12 }}>Messages are <b>simulated</b> on this server (SMS provider = log): they are recorded in the outbox but no SMS is sent. Set <code>SMS_PROVIDER=semaphore</code> with your Semaphore key and NTC-registered sender name to go live.</div>}
      {msg && <div className="badge info" style={{ marginBottom: 12 }}>{msg}</div>}

      {draft && (
        <div className="camp-builder">
          <div className="card">
            <h2>1 · Who</h2>
            {!draft.filter.segments && !Object.keys(draft.filter).length && <div className="row" style={{ marginBottom: 10, gap: '.4rem' }}><span className="small muted">Ideas:</span>{IDEAS.map((i) => <button key={i.name} className="btn sm" onClick={() => setDraft({ ...draft, name: i.name, filter: i.filter, template: i.template })}>{i.name}</button>)}</div>}
            <AudienceEditor value={draft.filter} onChange={(filter) => setDraft({ ...draft, filter })} tags={tags.data?.tags ?? []} tiers={settings.data?.settings.tiers.map((t) => t.name) ?? []} categories={settings.data?.settings.categories ?? []} />
            <h2 style={{ marginTop: 16 }}>2 · What</h2>
            <label className="field">Campaign name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Friday win-back" /></label>
            <div style={{ marginTop: 8 }}><TemplateEditor value={draft.template} onChange={(template) => setDraft({ ...draft, template })} /></div>
            <h2 style={{ marginTop: 16 }}>3 · Measure</h2>
            <label className="field">Holdout — guests deliberately not messaged, to prove the effect: {draft.holdoutPct}%
              <input type="range" min={0} max={30} step={5} value={draft.holdoutPct} onChange={(e) => setDraft({ ...draft, holdoutPct: Number(e.target.value) })} /></label>
            <div className="small muted">Without a holdout you only know who came — not who came <i>because</i> of the message. 10–20% is a good default.</div>
            {err && <div className="error">{err}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => { setDraft(null); setSp({}, { replace: true }); }}>Cancel</button>
              <div className="spacer" />
              <button className="btn primary" disabled={!draft.template.trim() || draft.template.trim().length < 5} onClick={saveDraft}>Save draft</button>
            </div>
          </div>
          <div className="card camp-preview">
            <h2>Audience</h2>
            {!preview && <div className="muted">Counting…</div>}
            {preview && <>
              <div className="aud-funnel">
                <div><b>{preview.matched}</b><span>match the filter</span></div>
                <div><b>{preview.eligible}</b><span>gave SMS consent</span></div>
                <div><b>≈{preview.toSend}</b><span>will be messaged</span></div>
                <div><b>≈{preview.holdout}</b><span>held out (random)</span></div>
              </div>
              {Object.entries(preview.excluded).map(([k, v]) => <div key={k} className="small muted">Excluded — {k}: {v}</div>)}
              <div className="kv-row" style={{ marginTop: 8 }}><span>Estimated cost</span><b>₱{preview.estCost.toFixed(2)} · {preview.parts} part{preview.parts > 1 ? 's' : ''} each</b></div>
              {preview.quiet && <div className="badge warn">Quiet hours now — sending will wait unless forced</div>}
              <h3 style={{ marginTop: 12 }}>Preview</h3>
              {preview.samples.map((s, i) => <div key={i} className="sms-bubble">{s.body}</div>)}
              {!preview.samples.length && <div className="muted small">Nobody to message with this filter.</div>}
            </>}
          </div>
        </div>
      )}

      <div className="grid" style={{ marginTop: draft ? 16 : 0 }}>
        {list.data?.map((c) => (
          <div key={c.id} className="card">
            <div className="row">
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <span className={`badge ${c.status === 'sent' ? 'good' : 'warn'}`}>{c.status}</span>
              <span className="small muted">{c.status === 'sent' ? `sent ${fmtDateTime(c.sentAt)} · ${c.messages} messages · ${c.holdout} held out` : `created ${fmtDateTime(c.createdAt)}`}</span>
              <div className="spacer" />
              {c.status === 'draft' && <>
                <button className="btn sm" onClick={async () => { await api.del(`/api/crm/campaigns/${c.id}`); await list.reload(); }}>Delete</button>
                {isAdmin(me?.role) ? <button className="btn sm primary" onClick={() => { setForceQuiet(false); setSending(c); }}>Send…</button> : <span className="small muted">An owner/admin sends campaigns</span>}
              </>}
            </div>
            <div className="sms-bubble" style={{ marginTop: 8 }}>{c.template}</div>
            <div className="small muted">Audience: {describe(c.filter)} · holdout {c.holdoutPct}% · conversions counted for {c.attributionDays} days</div>
            {c.result && <div style={{ marginTop: 10 }}><LiftCard r={c.result} /></div>}
          </div>
        ))}
        {list.data && !list.data.length && !draft && <div className="card muted">No campaigns yet. Start from a segment on the Marketing dashboard or press “New campaign”.</div>}
      </div>

      {sending && <ConfirmDialog title={`Send “${sending.name}”?`} confirmLabel="Send now"
        message={<>Messages go to every guest in the audience who gave SMS consent, except the {sending.holdoutPct}% holdout. This cannot be undone.
          <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" checked={forceQuiet} onChange={(e) => setForceQuiet(e.target.checked)} /> Send even during quiet hours</label></>}
        onClose={() => setSending(null)}
        onConfirm={async () => { const r = await api.post<{ sent: number; failed: number; holdout: number; provider: string }>(`/api/crm/campaigns/${sending.id}/send`, { force: forceQuiet }); setMsg(`Sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ''} · ${r.holdout} held out · provider ${r.provider}`); await list.reload(); }} />}
    </>
  );
}

function describe(f: AudienceFilter) {
  const p: string[] = [];
  if (f.segments?.length) p.push(f.segments.map((s) => SEGMENT_LABEL[s]).join(' / '));
  if (f.tiers?.length) p.push(`tier ${f.tiers.join('/')}`);
  if (f.tags?.length) p.push(`tag ${f.tags.join('/')}`);
  if (f.categories?.length) p.push(`bought ${f.categories.join('/')}`);
  if (f.minDaysSinceLastVisit !== undefined) p.push(`away ${f.minDaysSinceLastVisit}+ days`);
  if (f.maxDaysSinceLastVisit !== undefined) p.push(`seen within ${f.maxDaysSinceLastVisit} days`);
  if (f.minVisits !== undefined) p.push(`${f.minVisits}+ visits`);
  if (f.minSpend365 !== undefined) p.push(`₱${f.minSpend365.toLocaleString('en-PH')}+ in 12 mo`);
  if (f.birthdayWithinDays !== undefined) p.push(`birthday within ${f.birthdayWithinDays} days`);
  return p.join(' · ') || 'all guests';
}
