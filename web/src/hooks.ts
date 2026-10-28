import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Tiny data hook: GET a URL, expose data/error/loading and a reload(). */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await api.get<T>(url)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [url]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
