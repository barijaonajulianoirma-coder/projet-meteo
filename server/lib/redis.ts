/**
 * Client Redis optionnel pour le cache distribué et le rate-limiter partagé.
 *
 * Si REDIS_URL n'est pas défini, toutes les fonctions retournent null et
 * l'application fonctionne exactement comme avant (cache mémoire local).
 * Aucune régression en mono-instance.
 *
 * Usage multi-instances :
 *   REDIS_URL=redis://localhost:6379  npm run dev:server
 *
 * Prérequis (uniquement si REDIS_URL est défini) :
 *   npm install ioredis
 */

export interface RedisLike {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  call(...args: string[]): Promise<unknown>;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

const CONNECT_TIMEOUT_MS = 3_000;

/**
 * Parcourt les clés correspondant à un motif avec SCAN.
 * Contrairement à KEYS, SCAN ne bloque pas Redis : il avance par petits lots.
 */
export async function scanKeys(redis: RedisLike, pattern: string, count = 100): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return keys;
}

let client: RedisLike | null = null;
let connecting: Promise<RedisLike | null> | null = null;
/** Après un premier échec, on n'insiste pas : le cache local reste seul en jeu. */
let unavailable = false;

/**
 * Retourne le client Redis si REDIS_URL est défini, sinon null.
 * La connexion est établie de façon paresseuse au premier appel puis partagée.
 * L'import ioredis est dynamique : le module n'est pas requis à la compilation.
 */
export function getRedisClient(): Promise<RedisLike | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url || unavailable) return Promise.resolve(null);
  connecting ??= connect(url);
  return connecting;
}

async function connect(url: string): Promise<RedisLike | null> {
  try {
    // Import dynamique via nom construit : TypeScript ne résout pas les imports
    // dont la spécification est une expression, évitant ainsi TS2307 quand
    // ioredis n'est pas installé (dépendance optionnelle non déclarée en package.json).
    const moduleName = 'ioredis';
    const module = (await import(moduleName as string)) as {
      default: new (url: string, opts: Record<string, unknown>) => RedisLike;
    };
    const instance = new module.default(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    instance.on('error', (err: unknown) => {
      console.error('[redis] Erreur connexion :', err instanceof Error ? err.message : err);
    });
    // `lazyConnect` retarde la connexion : sans cet appel explicite, aucune
    // commande ne partirait jamais (et enableOfflineQueue la rejetterait).
    await instance.connect();
    client = instance;
    console.log('[redis] connecté : cache et rate limiting partagés entre instances.');
    return instance;
  } catch (error) {
    unavailable = true;
    connecting = null;
    console.warn(
      '[redis] Connexion impossible, cache mémoire local conservé :',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  connecting = null;
  unavailable = false;
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
