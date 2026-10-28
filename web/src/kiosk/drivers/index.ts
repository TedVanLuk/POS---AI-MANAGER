import { androidDriver } from './android';
import { secugenDriver } from './secugen';
import { simulatorDriver } from './simulator';
import type { BiometricDriver } from './types';

export const DRIVERS: BiometricDriver[] = [simulatorDriver, secugenDriver, androidDriver];
const KEY = 'aim.driver';

/** The driver chosen on THIS device (tablet), falling back to the server-side device setting. */
export function getDriver(fallback?: string): BiometricDriver {
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  return DRIVERS.find((d) => d.id === (id ?? fallback)) ?? simulatorDriver;
}
export function setDriver(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
}
export { simulatorDriver };
export * from './types';
