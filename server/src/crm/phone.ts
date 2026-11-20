/**
 * Philippine phone numbers. Customers type them every way imaginable at the counter
 * ("0917 123 4567", "9171234567", "+63-917-123-4567", "639171234567"), and the same person
 * must always land on the same profile, so everything is stored as E.164 (+639XXXXXXXXX).
 * Mobile prefixes are not used to guess the network: numbers are portable since the
 * Mobile Number Portability Act (RA 11202).
 */

/** E.164 for a PH mobile, or any other international number given with "+". Null when it is not a usable number. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  const plus = raw.startsWith('+') || raw.startsWith('00');
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) d = d.slice(2);
  // PH mobile: 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX
  if (/^09\d{9}$/.test(d)) return `+63${d.slice(1)}`;
  if (/^9\d{9}$/.test(d) && !plus) return `+63${d}`;
  if (/^639\d{9}$/.test(d)) return `+${d}`;
  // PH landline with area code is not textable — reject so marketing never targets it.
  if (d.startsWith('63') || (!plus && d.startsWith('0'))) return null;
  // Foreign number (tourists, expats), only when written with a country code.
  if (plus && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

export const isPhMobile = (e164: string | null | undefined) => !!e164 && /^\+639\d{9}$/.test(e164);

/** "+639171234567" → "0917 123 4567" (how Filipinos read numbers); foreign numbers stay in E.164. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  if (isPhMobile(e164)) { const l = `0${e164.slice(3)}`; return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`; }
  return e164;
}

/** "0917 ••• 4567" for screens where staff only need to confirm, not read, the number. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const f = formatPhone(e164);
  return isPhMobile(e164) ? `${f.slice(0, 4)} ••• ${f.slice(-4)}` : `${e164.slice(0, 4)}••••${e164.slice(-3)}`;
}
