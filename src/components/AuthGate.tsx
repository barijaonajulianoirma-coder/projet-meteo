import type { ReactNode } from 'react';
import { useAuth } from '../auth.js';
import { Login } from '../pages/Login.js';
import { Loading } from './ui.js';

/** N'affiche l'application qu'une fois la session vérifiée. */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { loading, required, authenticated } = useAuth();

  if (loading) return <Loading label="Vérification de la session…" />;
  if (required && !authenticated) return <Login />;
  return <>{children}</>;
}
