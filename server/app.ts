import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express, { type ErrorRequestHandler, type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { AuthConfig } from './lib/auth.js';
import { LoginThrottle } from './lib/bruteForce.js';
import { toApiErrorBody } from './lib/errors.js';
import { RedisRateLimitStore } from './lib/rateLimitStore.js';
import { analysisRouter } from './routes/analysis.js';
import { authRouter, requireAuth } from './routes/auth.js';
import { historyRouter } from './routes/history.js';
import { weatherRouter } from './routes/weather.js';

export interface AppOptions {
  staticDir?: string | null;
  rateLimit?: boolean;
  /** Authentification active. Absente ou null : accès libre (usage local uniquement). */
  auth?: AuthConfig | null;
  /** Compteur de force brute injectable (tests). */
  throttle?: LoginThrottle;
  /** Réglage Express `trust proxy` (obligatoire derrière un reverse proxy). */
  trustProxy?: boolean | number | string;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');

  if (options.trustProxy !== undefined) {
    app.set('trust proxy', options.trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      // HSTS n'a d'effet qu'en HTTPS ; activé pour tout déploiement derrière TLS.
      hsts: { maxAge: 15_552_000, includeSubDomains: true, preload: false },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '16kb' }));

  if (options.rateLimit !== false) {
    app.use(
      '/api',
      rateLimit({
        windowMs: 60_000,
        limit: 120,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        // Store Redis si REDIS_URL est défini, compteur mémoire sinon.
        store: new RedisRateLimitStore('api'),
        message: { error: 'Trop de requêtes', reason: 'Réessayez dans une minute.' },
      }),
    );
  }

  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  const auth = options.auth ?? null;
  if (auth) {
    const throttle = options.throttle ?? new LoginThrottle();

    // Limiteur dédié à la connexion : bien plus strict que le limiteur global.
    if (options.rateLimit !== false) {
      app.use(
        '/api/auth/login',
        rateLimit({
          windowMs: 60_000,
          limit: 10,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          store: new RedisRateLimitStore('login'),
          message: { error: 'Trop de requêtes', reason: 'Trop de tentatives de connexion, réessayez dans une minute.' },
        }),
      );
    }

    app.use('/api', authRouter(auth, throttle));
    // Toute autre route /api exige une session valide.
    app.use('/api', requireAuth(auth));
  }

  app.use('/api', weatherRouter());
  app.use('/api', historyRouter());
  app.use('/api', analysisRouter());
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route API inconnue' });
  });

  const staticDir = options.staticDir ?? null;
  const indexFile = staticDir ? path.join(staticDir, 'index.html') : null;
  if (staticDir && indexFile && fs.existsSync(indexFile)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const { status, body } = toApiErrorBody(error);
    if (status >= 500) {
      console.error(`[api] ${status} —`, error instanceof Error ? error.message : error);
    }
    res.status(status).json(body);
  };
  app.use(errorHandler);

  return app;
}
