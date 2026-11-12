import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAuthStatus, login as apiLogin, logout as apiLogout } from './api.js';

interface AuthState {
  loading: boolean;
  required: boolean;
  authenticated: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAuthStatus(controller.signal)
      .then((status) => {
        setRequired(status.required);
        setAuthenticated(status.authenticated);
        setUsername(status.username);
      })
      .catch(() => {
        // État inconnu : on laisse l'application s'afficher et les appels API
        // renverront 401 le cas échéant.
        setRequired(false);
        setAuthenticated(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const login = useCallback(async (name: string, password: string) => {
    const status = await apiLogin(name, password);
    setRequired(status.required);
    setAuthenticated(status.authenticated);
    setUsername(status.username);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAuthenticated(false);
    setUsername(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ loading, required, authenticated, username, login, logout }),
    [loading, required, authenticated, username, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans AuthProvider.');
  return context;
}
