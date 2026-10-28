import type { BiometricDriver } from './types';

/**
 * SecuGen WebAPI (free "SgiBioSrv" local service for Windows) — works with Hamster Pro 20 / Pro / Plus.
 * Install the service on the kiosk tablet, then open https://localhost:8443 once to trust its certificate.
 * Endpoints: SGIFPCapture (capture → TemplateBase64) and SGIMatchScore (0–199).
 * Verify parameters against the WebAPI programming manual for your SDK version.
 */
const BASE = 'https://localhost:8443';
const FORMAT = 'ISO';

async function call(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ licstr: '', ...params }).toString(),
    signal,
  });
  const json = await res.json();
  if (json.ErrorCode !== 0) {
    const messages: Record<number, string> = { 3: 'Reader not found — check the USB cable', 54: 'Timed out waiting for a finger', 55: 'Reader busy', 10004: 'Service licence error' };
    throw new Error(messages[json.ErrorCode] ?? `SecuGen error ${json.ErrorCode}`);
  }
  return json;
}

export const secugenDriver: BiometricDriver = {
  id: 'secugen-webapi',
  label: 'SecuGen Hamster (WebAPI, Windows)',
  threshold: 100,
  async init() {
    try {
      await fetch(`${BASE}/SGIFPGetInfo`, { method: 'POST' });
    } catch {
      throw new Error('SecuGen WebAPI service not reachable on https://localhost:8443 — install SgiBioSrv and trust its certificate');
    }
  },
  async capture({ timeoutMs = 10000, signal } = {}) {
    const r = await call('SGIFPCapture', { Timeout: String(timeoutMs), Quality: '50', templateFormat: FORMAT, imageWSQRate: '0.75' }, signal);
    return { template: r.TemplateBase64, format: 'ISO19794-2', quality: r.ImageQuality };
  },
  async match(a, b) {
    const r = await call('SGIMatchScore', { template1: a, template2: b, templateFormat: FORMAT });
    return Number(r.MatchingScore) || 0;
  },
};
