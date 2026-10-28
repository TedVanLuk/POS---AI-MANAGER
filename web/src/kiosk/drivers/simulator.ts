import type { BiometricDriver, CaptureResult } from './types';

type Waiter = (r: CaptureResult) => void;
let waiter: Waiter | null = null;
const listeners = new Set<(waiting: boolean) => void>();
const notify = () => listeners.forEach((l) => l(!!waiter));

/** Demo driver: the kiosk shows "virtual finger" buttons; pressing one resolves capture(). */
export const simulatorDriver: BiometricDriver & {
  press(template: string): void;
  onWaiting(fn: (waiting: boolean) => void): () => void;
} = {
  id: 'simulator',
  label: 'Simulator (no hardware)',
  threshold: 100,
  async init() { /* always available */ },
  capture({ timeoutMs = 0, signal } = {}) {
    return new Promise<CaptureResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (r: CaptureResult) => { clearTimeout(timer); waiter = null; notify(); resolve(r); };
      waiter = done;
      notify();
      if (timeoutMs) timer = setTimeout(() => { waiter = null; notify(); reject(new Error('timeout')); }, timeoutMs);
      signal?.addEventListener('abort', () => { clearTimeout(timer); waiter = null; notify(); reject(new Error('aborted')); });
    });
  },
  async match(a, b) { return a === b ? 180 : 0; },
  press(template) { waiter?.({ template, format: 'SIMULATED', quality: 90 }); },
  onWaiting(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
