/**
 * Store `express-rate-limit` partagé entre instances, adossé à Redis.
 *
 * Sans REDIS_URL (ou si Redis est injoignable), les compteurs restent en
 * mémoire via le `MemoryStore` intégré : comportement identique à l'original.
 *
 * Le comptage utilise INCR + PEXPIRE atomiques côté Redis, ce qui garantit un
 * plafond global (et non par instance) quand plusieurs processus tournent.
 */
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { getRedisClient, scanKeys, type RedisLike } from './redis.js';

export class RedisRateLimitStore implements Store {
  /** Les clés Redis sont partagées entre instances (pas de double comptage). */
  readonly localKeys = false;
  readonly prefix = 'meteo:rl:';

  private readonly fallback: MemoryStore;
  private readonly ready: Promise<void>;
  private redis: RedisLike | null = null;
  private windowMs = 60_000;

  /**
   * @param redis Client déjà résolu (tests) ; omis, la connexion est établie
   *   paresseusement depuis REDIS_URL ; `null` force le compteur mémoire.
   */
  constructor(
    private readonly name: string,
    redis?: RedisLike | null,
  ) {
    this.fallback = new MemoryStore();
    if (redis !== undefined) {
      this.redis = redis;
      this.ready = Promise.resolve();
      return;
    }
    this.ready = getRedisClient().then((client) => {
      this.redis = client;
    });
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private key(key: string): string {
    return `${this.prefix}${this.name}:${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redis = await this.connected();
    if (!redis) return this.fallback.increment(key);
    try {
      const redisKey = this.key(key);
      const totalHits = Number(await redis.call('INCR', redisKey));
      if (totalHits === 1) await redis.call('PEXPIRE', redisKey, String(this.windowMs));
      const ttl = Number(await redis.call('PTTL', redisKey));
      return { totalHits, resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined };
    } catch {
      // Redis devient indisponible en cours de route : on ne bloque personne.
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    const redis = await this.connected();
    if (!redis) {
      this.fallback.decrement(key);
      return;
    }
    try {
      // DECR peut descendre sous zéro : on recale la clé à 0.
      const remaining = Number(await redis.call('DECR', this.key(key)));
      if (remaining < 0) await redis.call('SET', this.key(key), '0', 'KEEPTTL');
    } catch {
      this.fallback.decrement(key);
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const redis = await this.connected();
    if (!redis) return this.fallback.get(key);
    try {
      const redisKey = this.key(key);
      const raw = await redis.get(redisKey);
      if (raw === null) return undefined;
      const ttl = Number(await redis.call('PTTL', redisKey));
      return { totalHits: Number(raw), resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined };
    } catch {
      return this.fallback.get(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    const redis = await this.connected();
    if (!redis) {
      this.fallback.resetKey(key);
      return;
    }
    await redis.del(this.key(key)).catch(() => {});
  }

  async resetAll(): Promise<void> {
    this.fallback.resetAll();
    const redis = await this.connected();
    if (!redis) return;
    const keys = await scanKeys(redis, `${this.prefix}${this.name}:*`).catch(() => [] as string[]);
    if (keys.length > 0) await redis.del(...keys).catch(() => {});
  }

  /** Attend la résolution de la connexion (paresseuse, une seule fois). */
  private async connected(): Promise<RedisLike | null> {
    await this.ready;
    return this.redis;
  }
}
