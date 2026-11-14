export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

import { getRedisClient, scanKeys, type RedisLike } from './redis.js';

/** Cache mémoire TTL avec éviction LRU (Least Recently Used). */
export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.store.size;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Mise à jour de l'ordre LRU : supprimer + réinsérer en fin de Map.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Si la clé existe déjà, la supprimer pour la remettre en fin (LRU).
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Expulser la première clé = la moins récemment utilisée.
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Cache Redis partagé entre instances — même interface que TtlCache mais async.
 * Utilisé automatiquement quand REDIS_URL est défini.
 */
export class RedisTtlCache<T> {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix: string,
    private readonly ttlSeconds: number,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(`${this.prefix}:${key}`).catch(() => null);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value);
    await this.redis.setex(`${this.prefix}:${key}`, this.ttlSeconds, raw).catch(() => {});
  }

  async clear(): Promise<void> {
    const keys = await scanKeys(this.redis, `${this.prefix}:*`).catch(() => [] as string[]);
    if (keys.length > 0) await this.redis.del(...keys).catch(() => {});
  }
}

/**
 * Cache à deux niveaux : LRU local (toujours actif, synchrone) devant un cache
 * Redis partagé (optionnel). Une lecture Redis réussi réchauffe le niveau local
 * pour que les requêtes suivantes restent servies en mémoire.
 */
export class SharedCache<T> {
  constructor(
    private readonly local: TtlCache<T>,
    private readonly remote: RedisTtlCache<T> | null = null,
  ) {}

  get shared(): boolean {
    return this.remote !== null;
  }

  async get(key: string): Promise<T | undefined> {
    const hit = this.local.get(key);
    if (hit !== undefined) return hit;
    if (!this.remote) return undefined;
    const value = await this.remote.get(key);
    if (value !== undefined) this.local.set(key, value);
    return value;
  }

  async set(key: string, value: T): Promise<void> {
    this.local.set(key, value);
    if (this.remote) await this.remote.set(key, value);
  }

  async clear(): Promise<void> {
    this.local.clear();
    if (this.remote) await this.remote.clear();
  }
}

/**
 * Construit un cache nommé. Sans REDIS_URL (ou si Redis est injoignable),
 * équivaut à l'ancien TtlCache mémoire.
 */
export async function createSharedCache<T>(
  name: string,
  ttlMs: number,
  maxEntries = 500,
): Promise<SharedCache<T>> {
  const local = new TtlCache<T>(ttlMs, maxEntries);
  const redis = await getRedisClient();
  const remote = redis
    ? new RedisTtlCache<T>(redis, `meteo:cache:${name}`, Math.max(1, Math.ceil(ttlMs / 1000)))
    : null;
  return new SharedCache<T>(local, remote);
}
