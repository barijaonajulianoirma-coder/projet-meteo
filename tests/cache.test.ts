import { describe, expect, it } from 'vitest';
import { TtlCache } from '../server/lib/cache.js';

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
