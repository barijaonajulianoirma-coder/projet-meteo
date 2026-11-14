import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth.js';
import { AuthGate } from './components/AuthGate.js';
import { CoordinatesProvider } from './coordinates.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Layout } from './components/Layout.js';
import { Loading } from './components/ui.js';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard.js').then((m) => ({ default: m.Dashboard })));
const Forecasts = lazy(() => import('./pages/Forecasts.js').then((m) => ({ default: m.Forecasts })));
const History = lazy(() => import('./pages/History.js').then((m) => ({ default: m.History })));
const Methodology = lazy(() => import('./pages/Methodology.js').then((m) => ({ default: m.Methodology })));
const NotFound = lazy(() => import('./pages/NotFound.js').then((m) => ({ default: m.NotFound })));

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable dans le DOM.');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate>
          <CoordinatesProvider>
            <Layout>
              <ErrorBoundary>
                <Suspense fallback={<Loading label="Chargement de la page…" />}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/previsions" element={<Forecasts />} />
                    <Route path="/historique" element={<History />} />
                    <Route path="/methodologie" element={<Methodology />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </Layout>
          </CoordinatesProvider>
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
