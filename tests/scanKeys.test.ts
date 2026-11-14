import { describe, expect, it } from 'vitest';
import { scanKeys, type RedisLike } from '../server/lib/redis.js';

/** Faux client qui renvoie des pages successives pour vérifier la boucle de curseur. */
class PagedRedis implements RedisLike {
  readonly cursors: string[] = [];

  constructor(private readonly pages: Array<[string, string[]]>) {}

  async get(): Promise<string | null> {
    return null;
  }

  async setex(): Promise<unknown> {
    return 'OK';
  }

  async del(): Promise<unknown> {
    return 0;
  }

  async scan(cursor: string): Promise<[string, string[]]> {
    this.cursors.push(cursor);
    return this.pages[Number(cursor)] ?? ['0', []];
  }

  async call(): Promise<unknown> {
    return null;
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

describe('scanKeys', () => {
  it('parcourt toutes les pages jusqu’au curseur 0', async () => {
    const redis = new PagedRedis([
      ['1', ['meteo:cache:a', 'meteo:cache:b']],
      ['0', ['meteo:cache:c']],
    ]);

    await expect(scanKeys(redis, 'meteo:cache:*')).resolves.toEqual([
      'meteo:cache:a',
      'meteo:cache:b',
      'meteo:cache:c',
    ]);
    expect(redis.cursors).toEqual(['0', '1']);
  });
});
