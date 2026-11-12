import { describe, expect, it } from 'vitest';
import { coordinateSchema, dateRangeSchema } from '../shared/schemas.js';

describe('coordinateSchema', () => {
  it("valide des coordonnees correctes", () => {
    const result = coordinateSchema.safeParse({ latitude: '-18.8792', longitude: '47.5079' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBeCloseTo(-18.8792, 4);
      expect(result.data.longitude).toBeCloseTo(47.5079, 4);
    }
  });
  it("rejette latitude > 90", () => {
    const result = coordinateSchema.safeParse({ latitude: '91', longitude: '0' });
    expect(result.success).toBe(false);
  });
  it("rejette latitude < -90", () => {
    const result = coordinateSchema.safeParse({ latitude: '-91', longitude: '0' });
    expect(result.success).toBe(false);
  });
  it("rejette longitude > 180", () => {
    const result = coordinateSchema.safeParse({ latitude: '0', longitude: '181' });
    expect(result.success).toBe(false);
  });
  it("rejette longitude < -180", () => {
    const result = coordinateSchema.safeParse({ latitude: '0', longitude: '-181' });
    expect(result.success).toBe(false);
  });
  it("rejette une chaine non numerique", () => {
    const result = coordinateSchema.safeParse({ latitude: 'abc', longitude: '0' });
    expect(result.success).toBe(false);
  });
});

describe('dateRangeSchema', () => {
  it("valide une plage correcte", () => {
    const result = dateRangeSchema.safeParse({ start_date: '2000-01-01', end_date: '2000-12-31' });
    expect(result.success).toBe(true);
  });
  it("valide start_date == end_date", () => {
    const result = dateRangeSchema.safeParse({ start_date: '2000-06-01', end_date: '2000-06-01' });
    expect(result.success).toBe(true);
  });
  it("rejette start_date > end_date", () => {
    const result = dateRangeSchema.safeParse({ start_date: '2000-12-31', end_date: '2000-01-01' });
    expect(result.success).toBe(false);
  });
  it("rejette un format de date invalide", () => {
    const result = dateRangeSchema.safeParse({ start_date: '01/01/2000', end_date: '2000-12-31' });
    expect(result.success).toBe(false);
  });
  it("rejette une date manquante", () => {
    const result = dateRangeSchema.safeParse({ start_date: '2000-01-01' });
    expect(result.success).toBe(false);
  });
});
