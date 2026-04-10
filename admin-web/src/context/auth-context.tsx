import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiClient, setApiAuthToken } from '@/lib/api-client';
import type { User } from '@/types/domain';

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const applyToken = useCallback((nextToken: string | null) => {
    setToken(nextToken);
    setApiAuthToken(nextToken);
    // Note: Token is now stored in HttpOnly cookie by server; no sessionStorage needed
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore logout errors
    } finally {
      applyToken(null);
      setUser(null);
    }
  }, [applyToken]);

  const refreshMe = useCallback(async () => {
    const response = await apiClient.get('/auth/me');
    const me = response.data?.user as User | undefined;

    if (!me) {
      throw new Error('Failed to load user profile.');
    }

    if (me.role !== 'admin') {
      throw new Error('This dashboard is restricted to admin accounts.');
    }

    setUser(me);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post('/auth/login', { email, password });
    // Cookie-based auth is preferred, but keep bearer token when present for socket fallback.
    const nextToken = typeof response.data?.token === 'string' ? response.data.token : null;
    const nextUser = response.data?.user as User | undefined;

    if (!nextUser) {
      throw new Error('Invalid login response from server.');
    }

    if (nextUser.role !== 'admin') {
      throw new Error('Only admin users can access this dashboard.');
    }

    applyToken(nextToken);
    setUser(nextUser);
  }, [applyToken]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        // On app load, try to fetch user profile using existing cookie
        // If cookie is valid, this will succeed
        await refreshMe();
      } catch {
        // If refreshMe fails, user is not authenticated
        logout();
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, [logout, refreshMe]);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, loading, login, logout, refreshMe }),
    [token, user, loading, login, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
};
