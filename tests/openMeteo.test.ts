import { describe, expect, it } from 'vitest';
import {
  assertAligned,
  buildArchiveUrl,
  buildForecastUrl,
  buildHistoryPeriods,
  normalizeForecast,
} from '../server/lib/openMeteo.js';

describe('buildForecastUrl', () => {
  it("construit une URL valide", () => {
    const url = buildForecastUrl(-18.8792, 47.5079);
    expect(url).toContain('api.open-meteo.com');
    expect(url).toContain('latitude=-18.8792');
    expect(url).toContain('longitude=47.5079');
    expect(url).toContain('timezone=auto');
    expect(url).toContain('forecast_days=7');
  });
  it("inclut tous les champs current", () => {
    const url = buildForecastUrl(0, 0);
    expect(url).toContain('temperature_2m');
    expect(url).toContain('weather_code');
  });
});

describe('buildArchiveUrl', () => {
  it("construit une URL valide", () => {
    const url = buildArchiveUrl(-18.8792, 47.5079, '2000-01-01', '2000-12-31');
    expect(url).toContain('archive-api.open-meteo.com');
    expect(url).toContain('start_date=2000-01-01');
    expect(url).toContain('end_date=2000-12-31');
    expect(url).toContain('models=era5');
  });
});

describe('assertAligned', () => {
  it("ne leve pas d'erreur si les series sont alignees", () => {
    expect(() => assertAligned(['2000-01-01', '2000-01-02'], { a: [1, 2], b: [3, 4] })).not.toThrow();
  });
  it("leve une erreur si une serie est trop courte", () => {
    expect(() => assertAligned(['2000-01-01', '2000-01-02'], { a: [1] })).toThrow();
  });
  it("leve une erreur si une serie est trop longue", () => {
    expect(() => assertAligned(['2000-01-01'], { a: [1, 2, 3] })).toThrow();
  });
});

describe('buildHistoryPeriods', () => {
  it("genere une periode par annee", () => {
    const periods = buildHistoryPeriods('2000-01-01', '2002-12-31');
    expect(periods).toHaveLength(3);
    expect(periods[0]).toEqual({ start: '2000-01-01', end: '2000-12-31' });
    expect(periods[1]).toEqual({ start: '2001-01-01', end: '2001-12-31' });
    expect(periods[2]).toEqual({ start: '2002-01-01', end: '2002-12-31' });
  });
  it("tronque la premiere et derniere annee correctement", () => {
    const periods = buildHistoryPeriods('2000-06-15', '2001-03-20');
    expect(periods).toHaveLength(2);
    expect(periods[0]?.start).toBe('2000-06-15');
    expect(periods[0]?.end).toBe('2000-12-31');
    expect(periods[1]?.start).toBe('2001-01-01');
    expect(periods[1]?.end).toBe('2001-03-20');
  });
  it("genere une seule periode pour une meme annee", () => {
    const periods = buildHistoryPeriods('2000-03-01', '2000-09-30');
    expect(periods).toHaveLength(1);
    expect(periods[0]?.start).toBe('2000-03-01');
    expect(periods[0]?.end).toBe('2000-09-30');
  });
});

describe('normalizeForecast', () => {
  const validRaw = {
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
      time: ['2026-11-10T00:00'],
      temperature_2m: [23.1],
      relative_humidity_2m: [75],
      precipitation_probability: [10],
      precipitation: [0],
      wind_speed_10m: [11],
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

  it("normalise une reponse valide", () => {
    const payload = normalizeForecast(validRaw);
    expect(payload.kind).toBe('forecast');
    expect(payload.current?.temperature).toBe(24.5);
    expect(payload.hourly[0]?.temperature).toBe(23.1);
    expect(payload.daily[0]?.temperatureMax).toBe(29.5);
    expect(payload.fetchedAt).toBeTruthy();
  });

  it("conserve les null dans les series", () => {
    const raw = {
      ...validRaw,
      hourly: { ...validRaw.hourly, temperature_2m: [null] },
    };
    const payload = normalizeForecast(raw);
    expect(payload.hourly[0]?.temperature).toBeNull();
  });

  it("leve une erreur sur une structure manquante", () => {
    expect(() => normalizeForecast({ latitude: -18 })).toThrow();
  });

  it("leve une erreur si les series ne sont pas alignees", () => {
    const raw = {
      ...validRaw,
      hourly: { ...validRaw.hourly, temperature_2m: [1, 2, 3] }, // 3 != 1
    };
    expect(() => normalizeForecast(raw)).toThrow();
  });
});
