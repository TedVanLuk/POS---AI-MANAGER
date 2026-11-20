/**
 * Outbound messaging providers. "log" is the safe default: messages are stored as `simulated` and nothing
 * leaves the server, so pilots and demos never text real people by accident. "semaphore" sends real SMS
 * through Semaphore (semaphore.co), a Philippine gateway with NTC-registered sender names.
 * Viber / Messenger / email adapters plug in here behind the same interface.
 */
import { config } from '../config.js';
import type { Channel } from './engine.js';

export interface SendResult { status: 'sent' | 'simulated' | 'failed'; provider: string; ref: string | null; error: string | null }
export interface Provider { name: string; send(m: { channel: Channel; to: string; body: string; sender: string }): Promise<SendResult> }

const log: Provider = {
  name: 'log',
  async send() { return { status: 'simulated', provider: 'log', ref: null, error: null }; },
};

const semaphore: Provider = {
  name: 'semaphore',
  async send(m) {
    if (m.channel !== 'sms') return { status: 'failed', provider: 'semaphore', ref: null, error: `Semaphore cannot send ${m.channel}` };
    if (!config.semaphoreApiKey) return { status: 'failed', provider: 'semaphore', ref: null, error: 'SEMAPHORE_API_KEY is not set' };
    try {
      const body = new URLSearchParams({ apikey: config.semaphoreApiKey, number: m.to.replace(/^\+/, ''), message: m.body, sendername: m.sender });
      const res = await fetch('https://api.semaphore.co/api/v4/messages', { method: 'POST', body, signal: AbortSignal.timeout(15_000) });
      const data = await res.json().catch(() => null) as { message_id?: number; status?: string }[] | Record<string, unknown> | null;
      if (!res.ok || !Array.isArray(data) || !data[0]?.message_id) return { status: 'failed', provider: 'semaphore', ref: null, error: `Semaphore ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
      return { status: 'sent', provider: 'semaphore', ref: String(data[0].message_id), error: null };
    } catch (e) {
      return { status: 'failed', provider: 'semaphore', ref: null, error: (e as Error).message };
    }
  },
};

export function provider(): Provider { return config.smsProvider === 'semaphore' ? semaphore : log; }
