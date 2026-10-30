const TOKEN_KEY = 'aim.token';
const DEVICE_KEY = 'aim.deviceToken';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export const session = {
  token: () => store.get(TOKEN_KEY),
  setToken: (t: string | null) => store.set(TOKEN_KEY, t),
  deviceToken: () => store.get(DEVICE_KEY),
  setDeviceToken: (t: string | null) => store.set(DEVICE_KEY, t),
};

/** Set by the app shell to send the user back to the login screen. */
let onUnauthorized: (() => void) | undefined;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export const DEMO = import.meta.env.VITE_DEMO === '1';

async function request<T>(method: string, path: string, body?: unknown, opts: { device?: boolean } = {}): Promise<T> {
  if (DEMO) {
    // Artifact demo: the API runs in the browser (see demo/backend.ts).
    const { demoRequest } = await import('./demo/backend');
    try {
      return await demoRequest(method, path, body, opts.device ? null : session.token(), opts.device ? session.deviceToken() : null) as T;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && !opts.device && path !== '/api/auth/login') { session.setToken(null); onUnauthorized?.(); }
      throw e;
    }
  }
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = opts.device ? null : session.token();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.device) headers['x-device-token'] = session.deviceToken() ?? '';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !opts.device && path !== '/api/auth/login') {
      session.setToken(null);
      onUnauthorized?.();
    }
    const fieldErrors = (data?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
    const detail = fieldErrors ? Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ') : '';
    throw new ApiError(res.status, `${data?.error ?? res.statusText}${detail ? ` — ${detail}` : ''}`, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string, b?: unknown) => request<T>('DELETE', p, b),
  device: {
    get: <T>(p: string) => request<T>('GET', p, undefined, { device: true }),
    post: <T>(p: string, b: unknown) => request<T>('POST', p, b, { device: true }),
  },
};

export const peso = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Business timezone (from the tenant) — all dates/times are shown in it, never the browser's zone. */
let displayTz: string | undefined;
export const setDisplayTimezone = (tz: string | undefined) => { displayTz = tz; };
export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: displayTz }) : '—';
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: displayTz }) : '—';
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: displayTz });
export const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: displayTz });
export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`);
