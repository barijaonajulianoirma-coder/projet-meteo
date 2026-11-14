/**
 * Tests -- authentification : hachage scrypt, sessions signées, configuration.
 */
import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  generateSessionSecret,
  hashPassword,
  loadAuthConfig,
  parseCookies,
  safeEqual,
  verifyPassword,
  verifySessionToken,
  type AuthConfig,
} from '../server/lib/auth.js';

const PASSWORD = 'mot-de-passe-de-test-2026';
const SECRET = 'secret-de-session-de-test-suffisamment-long';

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    username: 'meteo',
    passwordHash: hashPassword(PASSWORD),
    sessionSecret: SECRET,
    sessionTtlSeconds: 3600,
    ...overrides,
  };
}

describe('hashPassword / verifyPassword', () => {
  it('accepte le bon mot de passe', () => {
    const hash = hashPassword(PASSWORD);
    expect(verifyPassword(PASSWORD, hash)).toBe(true);
  });

  it('refuse un mauvais mot de passe', () => {
    const hash = hashPassword(PASSWORD);
    expect(verifyPassword('mauvais', hash)).toBe(false);
    expect(verifyPassword(PASSWORD + ' ', hash)).toBe(false);
  });

  it('produit des hash différents pour le même mot de passe (sel aléatoire)', () => {
    expect(hashPassword(PASSWORD)).not.toBe(hashPassword(PASSWORD));
  });

  it('utilise le format scrypt attendu', () => {
    expect(hashPassword(PASSWORD)).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
  });

  it("traite un hash mal formé comme un échec, sans exception", () => {
    expect(verifyPassword(PASSWORD, '')).toBe(false);
    expect(verifyPassword(PASSWORD, 'bcrypt$abc')).toBe(false);
    expect(verifyPassword(PASSWORD, 'scrypt$x$8$1$sel$hash')).toBe(false);
    expect(verifyPassword('', hashPassword(PASSWORD))).toBe(false);
  });
});

describe('sessions signées', () => {
  it('valide un jeton fraîchement créé', () => {
    const cfg = config();
    const token = createSessionToken(cfg);
    const payload = verifySessionToken(cfg, token);
    expect(payload?.sub).toBe('meteo');
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejette un jeton expiré', () => {
    const cfg = config({ sessionTtlSeconds: 60 });
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const token = createSessionToken(cfg, issuedAt);
    expect(verifySessionToken(cfg, token, new Date('2026-01-01T00:00:30Z'))).not.toBeNull();
    expect(verifySessionToken(cfg, token, new Date('2026-01-01T00:02:00Z'))).toBeNull();
  });

  it('rejette un jeton falsifié ou signé avec un autre secret', () => {
    const cfg = config();
    const token = createSessionToken(cfg);
    const [body, signature] = token.split('.');
    expect(verifySessionToken(cfg, `${body}.${signature}x`)).toBeNull();
    expect(verifySessionToken(cfg, 'charge.sans.signature')).toBeNull();
    expect(verifySessionToken(cfg, undefined)).toBeNull();
    expect(verifySessionToken(config({ sessionSecret: 'un-autre-secret-de-32-caracteres!!' }), token)).toBeNull();
  });

  it('rejette un jeton émis pour un autre utilisateur', () => {
    const cfg = config();
    const token = createSessionToken(cfg, new Date(), 'intrus');
    expect(verifySessionToken(cfg, token)).toBeNull();
  });

  it('génère des secrets aléatoires assez longs', () => {
    const secret = generateSessionSecret();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(secret).not.toBe(generateSessionSecret());
  });
});

describe('safeEqual', () => {
  it('compare correctement', () => {
    expect(safeEqual('meteo', 'meteo')).toBe(true);
    expect(safeEqual('meteo', 'meteO')).toBe(false);
    expect(safeEqual('meteo', 'meteo-long')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('parseCookies', () => {
  it('extrait les paires nom/valeur', () => {
    expect(parseCookies('a=1; meteo_session=abc.def; vide=')).toEqual({
      a: '1',
      meteo_session: 'abc.def',
      vide: '',
    });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('sans-valeur')).toEqual({});
  });

  it('ignore un cookie mal encodé sans lever d’exception', () => {
    expect(parseCookies('meteo_session=%ZZ; valide=1')).toEqual({ valide: '1' });
    expect(parseCookies('meteo_session=%E0%A4%A')).toEqual({});
  });
});

describe('loadAuthConfig', () => {
  const valid = (): NodeJS.ProcessEnv => ({
    AUTH_USERNAME: 'meteo',
    AUTH_PASSWORD_HASH: hashPassword(PASSWORD),
    SESSION_SECRET: SECRET,
  });

  it("retourne null quand l'authentification n'est pas configurée", () => {
    expect(loadAuthConfig({})).toBeNull();
    expect(loadAuthConfig({ AUTH_USERNAME: '  ' })).toBeNull();
  });

  it('charge une configuration complète', () => {
    const cfg = loadAuthConfig(valid());
    expect(cfg?.username).toBe('meteo');
    expect(cfg?.sessionTtlSeconds).toBe(12 * 3600);
  });

  it('accepte une durée de session personnalisée', () => {
    expect(loadAuthConfig({ ...valid(), SESSION_TTL_HOURS: '2' })?.sessionTtlSeconds).toBe(7200);
  });

  it('refuse une configuration partielle', () => {
    const partial = valid();
    delete partial.SESSION_SECRET;
    expect(() => loadAuthConfig(partial)).toThrow(/incomplète/i);
  });

  it('refuse un hash invalide', () => {
    expect(() => loadAuthConfig({ ...valid(), AUTH_PASSWORD_HASH: 'clair:motdepasse' })).toThrow(
      /AUTH_PASSWORD_HASH invalide/,
    );
  });

  it('refuse un secret trop court', () => {
    expect(() => loadAuthConfig({ ...valid(), SESSION_SECRET: 'court' })).toThrow(/SESSION_SECRET trop court/);
  });

  it('refuse une durée de session hors bornes', () => {
    expect(() => loadAuthConfig({ ...valid(), SESSION_TTL_HOURS: '0' })).toThrow(/SESSION_TTL_HOURS invalide/);
    expect(() => loadAuthConfig({ ...valid(), SESSION_TTL_HOURS: '169' })).toThrow(/SESSION_TTL_HOURS invalide/);
    expect(() => loadAuthConfig({ ...valid(), SESSION_TTL_HOURS: 'abc' })).toThrow(/SESSION_TTL_HOURS invalide/);
  });
});
