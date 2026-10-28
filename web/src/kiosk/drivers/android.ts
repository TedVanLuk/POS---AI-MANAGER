import type { BiometricDriver } from './types';

/**
 * Bridge contract implemented by the Android kiosk wrapper (Capacitor/WebView + vendor SDK,
 * e.g. SecuGen FDx SDK Pro for Android or ZKFinger SDK over USB-OTG). The native side injects:
 *
 *   window.AIMBiometric = {
 *     info(): Promise<{ vendor: string; model: string; format: string; threshold: number }>,
 *     capture(timeoutMs: number): Promise<{ template: string; format: string; quality: number }>,
 *     match(a: string, b: string): Promise<number>,
 *   }
 */
interface NativeBridge {
  info(): Promise<{ vendor: string; model: string; format: string; threshold: number }>;
  capture(timeoutMs: number): Promise<{ template: string; format: string; quality: number }>;
  match(a: string, b: string): Promise<number>;
}
const bridge = () => (window as unknown as { AIMBiometric?: NativeBridge }).AIMBiometric;

export const androidDriver: BiometricDriver = {
  id: 'android-bridge',
  label: 'Android tablet (native USB bridge)',
  threshold: 100,
  async init() {
    const b = bridge();
    if (!b) throw new Error('Native fingerprint bridge not found — open the kiosk inside the AI Manager Android app');
    const info = await b.info();
    this.threshold = info.threshold;
  },
  async capture({ timeoutMs = 10000 } = {}) {
    const b = bridge();
    if (!b) throw new Error('Native bridge missing');
    return b.capture(timeoutMs);
  },
  async match(a, b) { return bridge()!.match(a, b); },
};
