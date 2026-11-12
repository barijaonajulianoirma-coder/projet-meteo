import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { OPEN_METEO_ATTRIBUTION, OPEN_METEO_TERMS_URL } from '../../shared/sources.js';
import { CoordinateSelector } from './CoordinateSelector.js';

const NAV_ITEMS = [
  { to: '/', label: 'Tableau de bord', end: true },
  { to: '/previsions', label: 'Prévisions', end: false },
  { to: '/historique', label: 'Historique', end: false },
  { to: '/methodologie', label: 'Méthodologie et sources', end: false },
];

export function Layout({ children }: { children: ReactNode }): JSX.Element {
  const { required, authenticated, logout } = useAuth();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenu">
        Aller au contenu principal
      </a>

      <header className="site-header">
        <div className="header-top">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              ◎
            </span>
            <span>
              Météo Analyse
              <small>Antananarivo et coordonnées personnalisées</small>
            </span>
          </Link>
          <CoordinateSelector />
          {required && authenticated && (
            <button
              type="button"
              className="button button-ghost session-logout"
              onClick={() => void logout()}
            >
              Se déconnecter
            </button>
          )}
        </div>

        <nav className="main-nav" aria-label="Navigation principale">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="contenu" className="content" tabIndex={-1}>
        {children}
      </main>

      <footer className="site-footer">
        <p>
          <strong>Conditions issues de modèles météorologiques.</strong> Les réanalyses ERA5 ne sont pas des mesures
          directes d’une station et ne constituent pas des prévisions.
        </p>
        <p>
          {OPEN_METEO_ATTRIBUTION}{' '}
          <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">
            Documentation Open-Meteo
          </a>{' '}
          ·{' '}
          <a href={OPEN_METEO_TERMS_URL} target="_blank" rel="noreferrer">
            Conditions d’utilisation
          </a>
        </p>
      </footer>
    </div>
  );
}
