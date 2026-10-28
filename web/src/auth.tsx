import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, session, setDisplayTimezone } from './api';

export type Role = 'owner' | 'admin' | 'manager' | 'employee';
export interface Me { userId: string; tenantId: string; role: Role; employeeId: string | null; name: string; tenantName?: string; timezone?: string }

const Ctx = createContext<{ me: Me | null; loading: boolean; login: (email: string, password: string) => Promise<Me>; logout: () => void }>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!session.token());
  useEffect(() => {
    if (!session.token()) return;
    api.get<Me>('/api/auth/me').then((m) => { setDisplayTimezone(m.timezone); setMe(m); }).catch(() => session.setToken(null)).finally(() => setLoading(false));
  }, []);
  const login = async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: Me }>('/api/auth/login', { email, password });
    session.setToken(r.token);
    setDisplayTimezone(r.user.timezone);
    setMe(r.user);
    return r.user;
  };
  const logout = () => { session.setToken(null); setMe(null); };
  return <Ctx.Provider value={{ me, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const isStaff = (r?: Role) => r === 'owner' || r === 'admin' || r === 'manager';
export const isAdmin = (r?: Role) => r === 'owner' || r === 'admin';
