import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth.js';
import { errorMessage } from '../api.js';

export function Login(): JSX.Element {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <main className="content">
        <section className="card login-card" aria-labelledby="login-title">
          <h1 id="login-title">Connexion requise</h1>
          <p className="page-intro">
            Cette instance est accessible depuis le réseau : l’accès aux données météo nécessite une
            authentification.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="login-username">Identifiant</label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="field">
              <label htmlFor="login-password">Mot de passe</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={submitting}
              />
            </div>

            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="button button-primary" disabled={submitting}>
              {submitting ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
