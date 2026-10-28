/** Offline punch queue — punches are stored locally when the network is down and synced later (idempotent clientUuid). */
export interface QueuedPunch { clientUuid: string; employeeId: string; matchScore?: number; punchedAt: string; name: string }
const KEY = 'aim.punchQueue';

export function loadQueue(): QueuedPunch[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
export function saveQueue(q: QueuedPunch[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* storage blocked */ }
}
export function enqueue(p: QueuedPunch) { saveQueue([...loadQueue(), p]); }

export async function flushQueue(send: (p: QueuedPunch) => Promise<unknown>) {
  const remaining: QueuedPunch[] = [];
  for (const p of loadQueue()) {
    try { await send(p); } catch (e) {
      // keep only on network errors; drop if the server rejected it (4xx) to avoid a stuck queue
      const status = (e as { status?: number }).status;
      if (!status || status >= 500) remaining.push(p);
    }
  }
  saveQueue(remaining);
  return remaining.length;
}
