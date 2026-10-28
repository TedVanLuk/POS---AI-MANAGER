export interface CaptureResult {
  /** Base64 (or vendor) template string. */
  template: string;
  format: string;
  quality?: number;
}

/**
 * Hardware abstraction for USB fingerprint readers.
 * Browsers can't reach USB readers directly, so each driver talks to a local bridge:
 *  - secugen-webapi:   SecuGen WebAPI service on the Windows tablet (https://localhost:8443)
 *  - android-bridge:   native plugin injected by the Android (Capacitor) kiosk wrapper as window.AIMBiometric
 *  - simulator:        on-screen buttons for demos / development
 */
export interface BiometricDriver {
  id: string;
  label: string;
  /** Minimum score that counts as the same finger (vendor-specific scale). */
  threshold: number;
  /** Throws with a human-readable message if the reader/bridge is not reachable. */
  init(): Promise<void>;
  /** Waits for a finger and returns its template. Rejects on timeout. */
  capture(opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CaptureResult>;
  /** Similarity score between two templates. */
  match(a: string, b: string): Promise<number>;
}

export interface EnrolledTemplate {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
  finger: string;
  format: string;
  template: string;
}

/** 1:N identification — best score above threshold wins. Matches in small parallel batches. */
export async function identify(driver: BiometricDriver, probe: CaptureResult, templates: EnrolledTemplate[]) {
  let best: { t: EnrolledTemplate; score: number } | null = null;
  const pool = templates.filter((t) => t.format === probe.format);
  for (let i = 0; i < pool.length; i += 8) {
    const batch = pool.slice(i, i + 8);
    const scores = await Promise.all(batch.map((t) => driver.match(probe.template, t.template).catch(() => 0)));
    scores.forEach((score, k) => {
      if (score >= driver.threshold && (!best || score > best.score)) best = { t: batch[k], score };
    });
  }
  return best as { t: EnrolledTemplate; score: number } | null;
}
