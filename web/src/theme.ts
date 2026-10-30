import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'aim.theme';

function systemTheme(): Theme {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}
function stored(): Theme | null {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; }
}

/** Apply a saved choice early (before React renders) so the page doesn't flash the wrong theme. */
export function applySavedTheme() {
  const t = stored();
  if (t) document.documentElement.setAttribute('data-theme', t);
}

/** Current theme + toggle. A manual choice is remembered on this device; otherwise the OS setting wins. */
export function useTheme() {
  const read = (): Theme => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' || attr === 'dark' ? attr : systemTheme();
  };
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    let mq: MediaQueryList | null = null;
    const onMq = () => setTheme(read());
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', onMq); } catch { /* ignore */ }
    return () => { obs.disconnect(); mq?.removeEventListener('change', onMq); };
  }, []);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    setTheme(next);
  };
  return { theme, toggle };
}
