import { describe, expect, it } from 'vitest';
import type { RedisLike } from '../server/lib/redis.js';
import { RedisRateLimitStore } from '../server/lib/rateLimitStore.js';

/** Faux compteur Redis : INCR/PEXPIRE/PTTL/DECR/SET/DEL. */
class FakeCounterRedis implements RedisLike {
  readonly counters = new Map<string, { hits: number; ttlMs: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.counters.get(key);
    return entry ? String(entry.hits) : null;
  }

  async setex(): Promise<unknown> {
    return 'OK';
  }

  async del(...keys: string[]): Promise<unknown> {
    for (const key of keys) this.counters.delete(key);
    return keys.length;
  }

  async scan(_cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    const pattern = String(args[args.indexOf('MATCH') + 1] ?? '*');
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return ['0', [...this.counters.keys()].filter((key) => key.startsWith(prefix))];
  }

  async call(...args: string[]): Promise<unknown> {
    const [command, key, value] = args;
    switch (command) {
      case 'INCR': {
        const entry = this.counters.get(key!) ?? { hits: 0, ttlMs: 0 };
        entry.hits += 1;
        this.counters.set(key!, entry);
        return entry.hits;
      }
      case 'PEXPIRE': {
        const entry = this.counters.get(key!);
        if (entry) entry.ttlMs = Number(value);
        return 1;
      }
      case 'PTTL':
        return this.counters.get(key!)?.ttlMs ?? -2;
      case 'DECR': {
        const entry = this.counters.get(key!) ?? { hits: 0, ttlMs: 0 };
        entry.hits -= 1;
        this.counters.set(key!, entry);
        return entry.hits;
      }
      case 'SET': {
        const entry = this.counters.get(key!);
        if (entry) entry.hits = Number(value);
        return 'OK';
      }
      default:
        throw new Error(`Commande non simulée : ${args.join(' ')}`);
    }
  }

  async connect(): Promise<unknown> {
    return 'OK';
  }

  async quit(): Promise<unknown> {
    return 'OK';
  }

  on(): this {
    return this;
  }
}

describe('RedisRateLimitStore', () => {
  it('incrémente et expose la fenêtre quand Redis est disponible', async () => {
    const redis: RedisLike = new FakeCounterRedis();
    const store = new RedisRateLimitStore('test', redis);
    store.init({ windowMs: 60_000 } as Parameters<RedisRateLimitStore['init']>[0]);

    // Les valeurs sont lues tout de suite : le store peut renvoyer son objet
    // interne, muté par l'incrémentation suivante.
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
    const second = await store.increment('1.2.3.4');
    expect(second.totalHits).toBe(2);
    expect(second.resetTime).toBeInstanceOf(Date);
    expect((await store.get('1.2.3.4'))?.totalHits).toBe(2);
    expect((redis as FakeCounterRedis).counters.get('meteo:rl:test:1.2.3.4')?.hits).toBe(2);

    await store.decrement('1.2.3.4');
    expect((await store.get('1.2.3.4'))?.totalHits).toBe(1);

    await store.resetKey('1.2.3.4');
    expect(await store.get('1.2.3.4')).toBeUndefined();
  });

  it('retombe sur le compteur mémoire sans Redis', async () => {
    // REDIS_URL absent dans les tests : le repli doit rester fonctionnel.
    const store = new RedisRateLimitStore('repli', null);
    store.init({ windowMs: 60_000 } as Parameters<RedisRateLimitStore['init']>[0]);

    expect((await store.increment('10.0.0.1')).totalHits).toBe(1);
    expect((await store.increment('10.0.0.1')).totalHits).toBe(2);
    expect((await store.get('10.0.0.1'))?.totalHits).toBe(2);

    await store.resetAll();
  });
});
