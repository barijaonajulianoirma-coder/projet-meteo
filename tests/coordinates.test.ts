import { describe, expect, it } from 'vitest';
import { CACHE_COORDINATE_DECIMALS, roundCoordinate, roundCoordinates } from '../server/lib/coordinates.js';

describe('roundCoordinate(s)', () => {
  it('arrondit à la précision des clés de cache', () => {
    expect(roundCoordinate(-18.87921)).toBe(-18.8792);
    expect(roundCoordinate(47.507949)).toBe(47.5079);
    expect(roundCoordinate(-0.00001)).toBe(0);
  });

  it('produit la même valeur pour deux points de la même cellule de cache', () => {
    const a = roundCoordinates(-18.87921, 47.507949);
    const b = roundCoordinates(-18.87924, 47.507912);
    expect(a).toEqual(b);
    expect(Object.keys(a)).toHaveLength(2);
  });

  it('expose la précision documentée', () => {
    expect(CACHE_COORDINATE_DECIMALS).toBe(4);
  });
});
