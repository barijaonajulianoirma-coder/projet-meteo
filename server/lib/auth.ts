/**
 * Authentification : hachage de mot de passe (scrypt) et sessions signées (HMAC).
 *
 * Aucun secret n'est stocké dans le dépôt : tout vient de l'environnement.
 * `AUTH_PASSWORD_HASH` contient un hash scrypt au format `scrypt$N$r$p$sel$empreinte`.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'meteo_session';

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
}

export interface SessionPayload {
  sub: string;
  exp: number;
}

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;

function toBase64Url(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buffer.toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

/** Hache un mot de passe avec un sel aléatoire (scrypt). */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  if (password.length === 0) throw new Error('Le mot de passe ne peut pas être vide.');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, toBase64Url(salt), toBase64Url(derived)].join('$');
}

function isScryptFormat(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  return [n, r, p].every((value) => /^\d+$/.test(value!)) && salt!.length > 0 && hash!.length > 0;
}

/**
 * Vérifie un mot de passe face au hash stocké, en temps constant.
 * Toute valeur mal formée est traitée comme un échec, jamais comme une exception.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (typeof password !== 'string' || password.length === 0) return false;
  if (!isScryptFormat(storedHash)) return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = storedHash.split('$');
  const expected = fromBase64Url(hashRaw!);
  let derived: Buffer;
  try {
    derived = scryptSync(password, fromBase64Url(saltRaw!), expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw),
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Compare deux chaînes en temps constant (longueurs différentes : comparaison factice). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Conserve un coût constant même en cas de longueur différente.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function sign(config: AuthConfig, body: string): string {
  return createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
}

/** Crée un jeton de session signé (stateless). */
export function createSessionToken(
  config: AuthConfig,
  now: Date = new Date(),
  username: string = config.username,
): string {
  const payload: SessionPayload = {
    sub: username,
    exp: Math.floor(now.getTime() / 1000) + config.sessionTtlSeconds,
  };
  const body = toBase64Url(JSON.stringify(payload));
  return `${body}.${sign(config, body)}`;
}

/** Valide signature et expiration ; retourne la charge utile ou null. */
export function verifySessionToken(
  config: AuthConfig,
  token: string | undefined,
  now: Date = new Date(),
): SessionPayload | null {
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(config, body))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;

  const { sub, exp } = payload as Partial<SessionPayload>;
  if (typeof sub !== 'string' || sub !== config.username) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  if (exp <= Math.floor(now.getTime() / 1000)) return null;
  return { sub, exp };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || name in cookies) continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      // Cookie mal encodé (% invalide) : ignoré plutôt que de faire échouer
      // toute la requête avec une erreur 500.
      continue;
    }
    cookies[name] = value;
  }
  return cookies;
}

/** Lit `AUTH_*` depuis l'environnement. Retourne null si l'authentification est désactivée. */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const username = env.AUTH_USERNAME?.trim() ?? '';
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim() ?? '';
  const sessionSecret = env.SESSION_SECRET?.trim() ?? '';
  const provided = [username, passwordHash, sessionSecret].filter((value) => value !== '').length;

  if (provided === 0) return null;
  if (provided !== 3) {
    throw new Error(
      'Authentification incomplète : AUTH_USERNAME, AUTH_PASSWORD_HASH et SESSION_SECRET doivent être définis ensemble.',
    );
  }
  if (!isScryptFormat(passwordHash)) {
    throw new Error(
      'AUTH_PASSWORD_HASH invalide : format attendu scrypt$N$r$p$sel$empreinte (générer avec `npm run auth:hash`).',
    );
  }
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET trop court : ${MIN_SECRET_LENGTH} caractères minimum.`);
  }

  const ttlRaw = env.SESSION_TTL_HOURS?.trim();
  let sessionTtlSeconds = DEFAULT_SESSION_TTL_SECONDS;
  if (ttlRaw) {
    if (!/^\d{1,3}$/.test(ttlRaw) || Number(ttlRaw) < 1 || Number(ttlRaw) > 168) {
      throw new Error('SESSION_TTL_HOURS invalide : entier entre 1 et 168 attendu.');
    }
    sessionTtlSeconds = Number(ttlRaw) * 3600;
  }

  return { username, passwordHash, sessionSecret, sessionTtlSeconds };
}

export function generateSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}
