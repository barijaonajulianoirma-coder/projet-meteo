/**
 * Routes d'authentification : connexion, déconnexion, état de session.
 *
 * La session est un jeton signé (HMAC) stocké dans un cookie httpOnly
 * SameSite=Strict, donc inaccessible au JavaScript de la page.
 */
import type { Request, RequestHandler, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { AuthConfig, SessionPayload } from '../lib/auth.js';
import {
  SESSION_COOKIE,
  createSessionToken,
  parseCookies,
  safeEqual,
  verifyPassword,
  verifySessionToken,
} from '../lib/auth.js';
import type { LoginThrottle } from '../lib/bruteForce.js';
import { ApiError } from '../lib/errors.js';

const MAX_BODY_FIELD_LENGTH = 200;

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'inconnu';
}

function readCredentials(body: unknown): { username: string; password: string } {
  if (typeof body !== 'object' || body === null) {
    throw new ApiError(400, 'Requête invalide', 'Corps JSON attendu.');
  }
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'Requête invalide', 'Identifiant et mot de passe requis.');
  }
  if (username.length === 0 || password.length === 0) {
    throw new ApiError(400, 'Requête invalide', 'Identifiant et mot de passe requis.');
  }
  if (username.length > MAX_BODY_FIELD_LENGTH || password.length > MAX_BODY_FIELD_LENGTH) {
    throw new ApiError(400, 'Requête invalide', 'Identifiant ou mot de passe trop long.');
  }
  return { username, password };
}

function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Extrait et valide la session de la requête. */
export function readSession(config: AuthConfig, req: Request): SessionPayload | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(config, cookies[SESSION_COOKIE]);
}

/**
 * Middleware : refuse les requêtes non authentifiées.
 * Utilisé uniquement lorsque l'authentification est configurée.
 */
export function requireAuth(config: AuthConfig): RequestHandler {
  return (req: Request, res: Response, next) => {
    if (readSession(config, req)) {
      next();
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.status(401).json({
      error: 'Authentification requise',
      reason: 'Connectez-vous pour accéder à cette ressource.',
    });
  };
}

export function authRouter(config: AuthConfig, throttle: LoginThrottle): Router {
  const router = createRouter();

  router.get('/auth/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const session = readSession(config, req);
    res.json({ required: true, authenticated: session !== null, username: session?.sub ?? null });
  });

  router.post('/auth/login', (req, res) => {
    const key = clientKey(req);
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      res.set('Cache-Control', 'no-store');
      res.status(429).json({
        error: 'Trop de tentatives',
        reason: `Réessayez dans ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
      return;
    }

    const { username, password } = readCredentials(req.body);

    // Les deux vérifications sont évaluées pour garder un coût uniforme.
    const usernameOk = safeEqual(username, config.username);
    const passwordOk = verifyPassword(password, config.passwordHash);

    if (!usernameOk || !passwordOk) {
      const locked = throttle.recordFailure(key);
      res.set('Cache-Control', 'no-store');
      if (locked) {
        res.set('Retry-After', String(Math.ceil(throttle.lockoutMs / 1000)));
        res.status(429).json({
          error: 'Trop de tentatives',
          reason: `Accès temporairement verrouillé pendant ${Math.ceil(throttle.lockoutMs / 60_000)} minute(s).`,
        });
        return;
      }
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }

    throttle.reset(key);
    const token = createSessionToken(config);
    // `req.secure` est correct derrière un reverse proxy si `trust proxy` est activé.
    res.set('Set-Cookie', sessionCookie(token, config.sessionTtlSeconds, req.secure));
    res.set('Cache-Control', 'no-store');
    res.json({ authenticated: true, username: config.username });
  });

  router.post('/auth/logout', (_req, res) => {
    res.set('Set-Cookie', clearCookie(_req.secure));
    res.set('Cache-Control', 'no-store');
    res.json({ authenticated: false });
  });

  return router;
}

/** Purge périodique des compteurs de force brute. */
export function startThrottlePruning(throttle: LoginThrottle, intervalMs = 60_000): () => void {
  const timer = setInterval(() => throttle.prune(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
