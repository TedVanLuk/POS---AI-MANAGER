import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';

interface Turn { role: 'user' | 'assistant'; content: string }
const SUGGESTIONS = [
  'Who was late the most this month and how much did it cost us?',
  'Summarize today: who is in, who is late, who is missing?',
  'Compare my servers — who is the fastest and who needs coaching?',
  'Explain the biggest differences in the last payroll run.',
  'Are there missing order-slip serial numbers I should check?',
];

export default function AIChat() {
  const status = useApi<{ enabled: boolean }>('/api/ai/status');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [turns, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text.trim() }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ reply: string }>('/api/ai/chat', { messages: next.slice(-20) });
      setTurns([...next, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setError((e as Error).message);
      setTurns(turns);
      setInput(text);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><h1>AI Manager</h1><span className="muted">Ask anything about attendance, payroll, penalties and performance</span><div className="spacer" />{turns.length > 0 && <button className="btn" onClick={() => setTurns([])}>New chat</button>}</div>
      {status.data && !status.data.enabled && <div className="notice">AI chat is not configured. Set <code>ANTHROPIC_API_KEY</code> in <code>server/.env</code> and restart the server.</div>}
      <div className="chat">
        <div className="msgs">
          {turns.length === 0 && (
            <div className="card">
              <p>I read your live HR data (read-only) and answer with numbers. Try:</p>
              <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {turns.map((t, i) => <div key={i} className={`msg ${t.role}`}>{t.content}</div>)}
          {busy && <div className="msg assistant muted">Looking at your data…</div>}
          <div ref={end} />
        </div>
        {error && <div className="error">{error}</div>}
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. How much overtime did the kitchen do this cutoff?" disabled={busy} />
          <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>
    </>
  );
}
