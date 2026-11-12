/**
 * Tests d'integration -- routes API backend.
 * Les appels Open-Meteo sont interceptes par des mocks fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../server/app.js';
import type { Express } from 'express';

// -- Reponse Open-Meteo minimale valide --
function mockForecastResponse() {
  return {
    latitude: -18.8792,
    longitude: 47.5079,
    timezone: 'Indian/Antananarivo',
    timezone_abbreviation: 'EAT',
    utc_offset_seconds: 10800,
    current_units: { temperature_2m: 'C', apparent_temperature: 'C', relative_humidity_2m: '%', precipitation: 'mm', weather_code: '', wind_speed_10m: 'km/h' },
    current: {
      time: '2026-11-10T12:00',
      interval: 900,
      temperature_2m: 24.5,
      apparent_temperature: 25.0,
      relative_humidity_2m: 72,
      precipitation: 0,
      weather_code: 1,
      wind_speed_10m: 12.3,
    },
    hourly_units: { temperature_2m: 'C', relative_humidity_2m: '%', precipitation_probability: '%', precipitation: 'mm', wind_speed_10m: 'km/h' },
    hourly: {
      time: ['2026-11-10T00:00', '2026-11-10T01:00'],
      temperature_2m: [23.1, 22.8],
      relative_humidity_2m: [75, 76],
      precipitation_probability: [10, 5],
      precipitation: [0, 0],
      wind_speed_10m: [11, 10],
    },
    daily_units: { temperature_2m_mean: 'C', temperature_2m_max: 'C', temperature_2m_min: 'C', precipitation_sum: 'mm' },
    daily: {
      time: ['2026-11-10'],
      temperature_2m_mean: [24.0],
      temperature_2m_max: [29.5],
      temperature_2m_min: [19.5],
      precipitation_sum: [0],
    },
  };
}

function mockArchiveResponse() {
  return {
    latitude: -18.8792,
    longitude: 47.5079,
    timezone: 'Indian/Antananarivo',
    timezone_abbreviation: 'EAT',
    utc_offset_seconds: 10800,
    daily_units: { temperature_2m_mean: 'C', temperature_2m_max: 'C', temperature_2m_min: 'C', precipitation_sum: 'mm' },
    daily: {
      time: ['2000-01-01', '2000-01-02'],
      temperature_2m_mean: [22.0, 23.5],
      temperature_2m_max: [28.0, 29.0],
      temperature_2m_min: [17.0, 18.0],
      precipitation_sum: [5.0, 0.0],
    },
  };
}

let app: Express;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  app = createApp({ staticDir: null, rateLimit: false });
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFetchOk(body: unknown): Response {
  const json = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(json),
  } as unknown as Response;
}

function makeFetchError(status: number, body: unknown): Response {
  const json = JSON.stringify(body);
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'retry-after': '' }),
    text: () => Promise.resolve(json),
  } as unknown as Response;
}

// -- /api/health --
describe('GET /api/health', () => {
  it("retourne status ok", async () => {
    const res = await supertest(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });
});

// -- /api/weather --
describe('GET /api/weather', () => {
  it("retourne un payload forecast valide", async () => {
    fetchSpy.mockResolvedValueOnce(makeFetchOk(mockForecastResponse()));
    const res = await supertest(app).get('/api/weather?latitude=-18.8792&longitude=47.5079');
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('forecast');
    expect(res.body.latitude).toBeCloseTo(-18.8792, 2);
    expect(res.body.current).not.toBeNull();
    expect(res.body.hourly).toHaveLength(2);
    expect(res.body.daily).toHaveLength(1);
    expect(res.body.fetchedAt).toBeTruthy();
    expect(res.header['x-cache']).toBe('MISS');
  });

  it("retourne 400 si latitude manquante", async () => {
    const res = await supertest(app).get('/api/weather?longitude=47.5079');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coordonn/i);
  });

  it("retourne 400 si latitude hors bornes", async () => {
    const res = await supertest(app).get('/api/weather?latitude=200&longitude=47.5079');
    expect(res.status).toBe(400);
  });

  it("retourne 400 si longitude hors bornes", async () => {
    const res = await supertest(app).get('/api/weather?latitude=-18.8&longitude=999');
    expect(res.status).toBe(400);
  });

  it("retourne 503 si Open-Meteo repond 500", async () => {
    // 2 retries => 3 appels — coordonnees distinctes pour eviter le cache d'un test precedent
    fetchSpy.mockResolvedValue(makeFetchError(500, { reason: 'Internal server error' }));
    const res = await supertest(app).get('/api/weather?latitude=-20.1234&longitude=48.5678');
    expect(res.status).toBe(503);
  });

  it("utilise le cache : deux requetes identiques ne font qu'un seul appel amont", async () => {
    fetchSpy.mockResolvedValue(makeFetchOk(mockForecastResponse()));
    await supertest(app).get('/api/weather?latitude=-18.0&longitude=47.0');
    await supertest(app).get('/api/weather?latitude=-18.0&longitude=47.0');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// -- /api/history --
describe('GET /api/history', () => {
  it("retourne un payload history valide", async () => {
    fetchSpy.mockResolvedValueOnce(makeFetchOk(mockArchiveResponse()));
    const res = await supertest(app)
      .get('/api/history?latitude=-18.8792&longitude=47.5079&start_date=2000-01-01&end_date=2000-01-02');
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('history');
    expect(res.body.daily).toHaveLength(2);
    expect(res.body.model).toBe('era5');
    expect(res.body.expectedDays).toBe(2);
    expect(res.body.availableDays).toBe(2);
    expect(res.body.missingDays).toHaveLength(0);
  });

  it("retourne 400 si start_date > end_date", async () => {
    const res = await supertest(app)
      .get('/api/history?latitude=-18.8792&longitude=47.5079&start_date=2000-12-31&end_date=2000-01-01');
    expect(res.status).toBe(400);
  });

  it("retourne 400 si date avant 1940", async () => {
    const res = await supertest(app)
      .get('/api/history?latitude=-18.8792&longitude=47.5079&start_date=1930-01-01&end_date=1930-12-31');
    expect(res.status).toBe(400);
    expect(res.body.reason).toMatch(/1940/);
  });

  it("retourne 400 si format de date invalide", async () => {
    const res = await supertest(app)
      .get('/api/history?latitude=-18.8792&longitude=47.5079&start_date=not-a-date&end_date=2000-01-01');
    expect(res.status).toBe(400);
  });

  it("signale les periodes en succes partiel", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeFetchOk(mockArchiveResponse()))
      .mockResolvedValue(makeFetchError(500, { reason: 'Server error' }));

    const res = await supertest(app)
      .get('/api/history?latitude=-18.8792&longitude=47.5079&start_date=2000-01-01&end_date=2001-12-31');
    expect(res.status).toBe(200);
    const periods = res.body.periods as Array<{ status: string }>;
    expect(periods.some((p) => p.status === 'error')).toBe(true);
    expect(periods.some((p) => p.status === 'ok' || p.status === 'empty')).toBe(true);
  });

  it("retourne 400 pour une date calendaire invalide", async () => {
    const res = await supertest(app)
      .get('/api/history?latitude=-18.8792&longitude=47.5079&start_date=2001-02-29&end_date=2001-03-01');
    expect(res.status).toBe(400);
  });
});

// -- /api/analysis --
describe('GET /api/analysis', () => {
  it('retourne un payload analysis valide', async () => {
    fetchSpy.mockResolvedValue(makeFetchOk(mockArchiveResponse()));
    const res = await supertest(app).get(
      '/api/analysis?latitude=-18.8792&longitude=47.5079&start_date=2000-01-01&end_date=2000-01-02',
    );
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('analysis');
    expect(res.body.period).toEqual({ start: '2000-01-01', end: '2000-01-02' });
    expect(res.body.descriptive.temperature).toBeTruthy();
    expect(res.body.ml).toBeTruthy();
    expect(res.body.mannKendall).toBeTruthy();
    expect(res.body.climatology).toHaveLength(12);
    expect(res.header['x-cache']).toBe('MISS');
  });

  it('utilise le cache pour une seconde requête identique', async () => {
    fetchSpy.mockResolvedValue(makeFetchOk(mockArchiveResponse()));
    await supertest(app).get(
      '/api/analysis?latitude=-17.5&longitude=46.5&start_date=2000-01-01&end_date=2000-01-02',
    );
    const second = await supertest(app).get(
      '/api/analysis?latitude=-17.5&longitude=46.5&start_date=2000-01-01&end_date=2000-01-02',
    );
    expect(second.status).toBe(200);
    expect(second.header['x-cache']).toBe('HIT');
  });

  it('retourne 400 si la période est invalide', async () => {
    const res = await supertest(app).get(
      '/api/analysis?latitude=-18.8792&longitude=47.5079&start_date=2001-01-01&end_date=2000-01-01',
    );
    expect(res.status).toBe(400);
  });
});

// -- Route inconnue --
describe('Route API inconnue', () => {
  it("retourne 404", async () => {
    const res = await supertest(app).get('/api/unknown');
    expect(res.status).toBe(404);
  });
});
