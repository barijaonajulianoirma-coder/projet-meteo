import { describe, expect, it } from 'vitest';
import type { RedisLike } from '../server/lib/redis.js';
import { RedisTtlCache, SharedCache, TtlCache } from '../server/lib/cache.js';

/** Faux client Redis : suffisant pour tester les commandes utilisées par le cache. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setex(key: string, seconds: number, value: string): Promise<unknown> {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<unknown> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }

  async scan(_cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    const pattern = String(args[args.indexOf('MATCH') + 1] ?? '*');
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return ['0', [...this.store.keys()].filter((key) => key.startsWith(prefix))];
  }

  async call(...args: string[]): Promise<unknown> {
    throw new Error(`Commande non simulée : ${args.join(' ')}`);
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

describe('TtlCache', () => {
  it('stocke et récupère une valeur', () => {
    const cache = new TtlCache<number>(10_000);
    cache.set('a', 42);
    expect(cache.get('a')).toBe(42);
  });

  it('retourne undefined pour une clé absente', () => {
    const cache = new TtlCache<number>(10_000);
    expect(cache.get('x')).toBeUndefined();
  });

  it('expire une entrée après le TTL', () => {
    let now = 1_000_000;
    const cache = new TtlCache<number>(500, 100, () => now);
    cache.set('b', 7);
    now += 600; // TTL dépassé
    expect(cache.get('b')).toBeUndefined();
  });

  it('ne retourne pas undefined juste avant expiration', () => {
    let now = 1_000_000;
    const cache = new TtlCache<number>(500, 100, () => now);
    cache.set('c', 9);
    now += 400; // encore valide
    expect(cache.get('c')).toBe(9);
  });

  it('évince la plus ancienne entrée quand maxEntries est atteint', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // évince 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('conserve les entrées récemment lues (LRU, pas FIFO)', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // 'a' redevient la plus récente
    cache.set('c', 3); // évince donc 'b', pas 'a'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('remplace la valeur sans consommer de place supplémentaire', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    expect(cache.get('a')).toBe(10);
    expect(cache.size).toBe(2);
  });

  it('clear vide le cache', () => {
    const cache = new TtlCache<number>(10_000);
    cache.set('x', 1);
    cache.set('y', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('taille reportée correctement', () => {
    const cache = new TtlCache<string>(10_000);
    expect(cache.size).toBe(0);
    cache.set('k', 'v');
    expect(cache.size).toBe(1);
  });
});

describe('RedisTtlCache', () => {
  it('écrit avec un TTL et relit la valeur sérialisée', async () => {
    const redis = new FakeRedis();
    const cache = new RedisTtlCache<{ value: number }>(redis, 'test', 60);

    await cache.set('a', { value: 42 });

    expect(redis.store.get('test:a')?.value).toBe('{"value":42}');
    expect(await cache.get('a')).toEqual({ value: 42 });
  });

  it('retourne undefined pour une clé absente ou illisible', async () => {
    const redis = new FakeRedis();
    const cache = new RedisTtlCache<number>(redis, 'test', 60);
    expect(await cache.get('absente')).toBeUndefined();

    redis.store.set('test:corrompue', { value: 'pas du JSON', expiresAt: null });
    expect(await cache.get('corrompue')).toBeUndefined();
  });

  it('clear ne supprime que les clés de son préfixe', async () => {
    const redis = new FakeRedis();
    const cache = new RedisTtlCache<number>(redis, 'test', 60);
    await cache.set('a', 1);
    await cache.set('b', 2);
    redis.store.set('autre:c', { value: '3', expiresAt: null });

    await cache.clear();

    expect([...redis.store.keys()]).toEqual(['autre:c']);
  });
});

describe('SharedCache', () => {
  it('sert une entrée locale sans interroger Redis', async () => {
    const redis = new FakeRedis();
    let remoteReads = 0;
    const remote = new RedisTtlCache<number>(redis, 'test', 60);
    remote.get = async () => {
      remoteReads += 1;
      return undefined;
    };
    const cache = new SharedCache<number>(new TtlCache<number>(60_000), remote);

    await cache.set('a', 1);
    expect(await cache.get('a')).toBe(1);
    expect(remoteReads).toBe(0);
  });

  it('remplit le niveau local depuis Redis en cas de défaut local', async () => {
    const redis = new FakeRedis();
    const remote = new RedisTtlCache<number>(redis, 'test', 60);
    await remote.set('a', 7);

    const cache = new SharedCache<number>(new TtlCache<number>(60_000), remote);
    expect(await cache.get('a')).toBe(7);
    // Deuxième lecture : servie par la mémoire locale.
    redis.store.clear();
    expect(await cache.get('a')).toBe(7);
  });

  it('fonctionne sans Redis (comportement mono-instance)', async () => {
    const cache = new SharedCache<number>(new TtlCache<number>(60_000), null);
    expect(cache.shared).toBe(false);
    expect(await cache.get('a')).toBeUndefined();
    await cache.set('a', 3);
    expect(await cache.get('a')).toBe(3);
    await cache.clear();
    expect(await cache.get('a')).toBeUndefined();
  });
});
