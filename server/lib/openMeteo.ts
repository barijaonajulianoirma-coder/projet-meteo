import { archiveResponseSchema, forecastResponseSchema } from '../../shared/schemas.js';
import { FORECAST_SOURCE } from '../../shared/sources.js';
import type { DailyPoint, ForecastPayload, UnitMap } from '../../shared/types.js';
import { ApiError } from './errors.js';

export const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const ARCHIVE_ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';

export const FORECAST_PARAMS = {
  current: [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
  ],
  hourly: [
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation_probability',
    'precipitation',
    'wind_speed_10m',
  ],
  daily: ['temperature_2m_mean', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'],
} as const;

export const ARCHIVE_PARAMS = {
  daily: ['temperature_2m_mean', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'],
} as const;

/** Toujours construite avec URLSearchParams : aucune URL client n'est acceptée. */
export function buildForecastUrl(latitude: number, longitude: number, forecastDays = 7): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: FORECAST_PARAMS.current.join(','),
    hourly: FORECAST_PARAMS.hourly.join(','),
    daily: FORECAST_PARAMS.daily.join(','),
    timezone: 'auto',
    forecast_days: String(forecastDays),
  });
  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

export function buildArchiveUrl(latitude: number, longitude: number, startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: ARCHIVE_PARAMS.daily.join(','),
    models: 'era5',
    timezone: 'auto',
  });
  return `${ARCHIVE_ENDPOINT}?${params.toString()}`;
}

/** Vérifie que chaque série a exactement la longueur de l'axe temporel. */
export function assertAligned(time: string[], series: Record<string, unknown[]>): void {
  for (const [name, values] of Object.entries(series)) {
    if (values.length !== time.length) {
      throw new ApiError(
        502,
        'Réponse de l’API météo incohérente',
        `Série « ${name} » de longueur ${values.length} alors que ${time.length} dates sont attendues`,
      );
    }
  }
}

function pickUnits(units: UnitMap, keys: readonly string[]): UnitMap {
  const selected: UnitMap = {};
  for (const key of keys) {
    const unit = units[key];
    if (unit) selected[key] = unit;
  }
  return selected;
}

export function normalizeForecast(rawInput: unknown): ForecastPayload {
  const parsed = forecastResponseSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ApiError(502, 'Réponse de l’API météo inexploitable', 'Structure de prévision non conforme');
  }
  const raw = parsed.data;
  assertAligned(raw.hourly.time, {
    temperature_2m: raw.hourly.temperature_2m,
    relative_humidity_2m: raw.hourly.relative_humidity_2m,
    precipitation_probability: raw.hourly.precipitation_probability,
    precipitation: raw.hourly.precipitation,
    wind_speed_10m: raw.hourly.wind_speed_10m,
  });
  assertAligned(raw.daily.time, {
    temperature_2m_mean: raw.daily.temperature_2m_mean,
    temperature_2m_max: raw.daily.temperature_2m_max,
    temperature_2m_min: raw.daily.temperature_2m_min,
    precipitation_sum: raw.daily.precipitation_sum,
  });

  const hourly = raw.hourly.time.map((time, index) => ({
    time,
    temperature: raw.hourly.temperature_2m[index] ?? null,
    humidity: raw.hourly.relative_humidity_2m[index] ?? null,
    precipitationProbability: raw.hourly.precipitation_probability[index] ?? null,
    precipitation: raw.hourly.precipitation[index] ?? null,
    windSpeed: raw.hourly.wind_speed_10m[index] ?? null,
  }));

  const daily: DailyPoint[] = raw.daily.time.map((date, index) => ({
    date,
    temperatureMean: raw.daily.temperature_2m_mean[index] ?? null,
    temperatureMax: raw.daily.temperature_2m_max[index] ?? null,
    temperatureMin: raw.daily.temperature_2m_min[index] ?? null,
    precipitationSum: raw.daily.precipitation_sum[index] ?? null,
  }));

  const current = raw.current
    ? {
        time: raw.current.time,
        intervalSeconds: raw.current.interval ?? 0,
        temperature: raw.current.temperature_2m,
        apparentTemperature: raw.current.apparent_temperature,
        humidity: raw.current.relative_humidity_2m,
        precipitation: raw.current.precipitation,
        weatherCode: raw.current.weather_code,
        windSpeed: raw.current.wind_speed_10m,
      }
    : null;

  return {
    kind: 'forecast',
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    timezoneAbbreviation: raw.timezone_abbreviation,
    utcOffsetSeconds: raw.utc_offset_seconds,
    units: {
      current: pickUnits(raw.current_units, FORECAST_PARAMS.current),
      hourly: pickUnits(raw.hourly_units, FORECAST_PARAMS.hourly),
      daily: pickUnits(raw.daily_units, FORECAST_PARAMS.daily),
    },
    current,
    hourly,
    daily,
    fetchedAt: new Date().toISOString(),
    source: FORECAST_SOURCE,
  };
}

export interface ArchiveChunkResult {
  daily: DailyPoint[];
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  units: UnitMap;
}

/** Normalise une réponse d'archive pour une année (ou un fragment d'année). */
export function normalizeArchive(rawInput: unknown): ArchiveChunkResult {
  const parsed = archiveResponseSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ApiError(502, 'Réponse d’archive inexploitable', 'Structure ERA5 non conforme');
  }
  const raw = parsed.data;
  if (raw.error === true) {
    throw new ApiError(502, 'Réponse d’archive inexploitable', raw.reason ?? 'Erreur signalée par Open-Meteo');
  }
  assertAligned(raw.daily.time, {
    temperature_2m_mean: raw.daily.temperature_2m_mean,
    temperature_2m_max: raw.daily.temperature_2m_max,
    temperature_2m_min: raw.daily.temperature_2m_min,
    precipitation_sum: raw.daily.precipitation_sum,
  });

  return {
    daily: raw.daily.time.map((date, index) => ({
      date,
      temperatureMean: raw.daily.temperature_2m_mean[index] ?? null,
      temperatureMax: raw.daily.temperature_2m_max[index] ?? null,
      temperatureMin: raw.daily.temperature_2m_min[index] ?? null,
      precipitationSum: raw.daily.precipitation_sum[index] ?? null,
    })),
    timezone: raw.timezone,
    timezoneAbbreviation: raw.timezone_abbreviation,
    utcOffsetSeconds: raw.utc_offset_seconds,
    units: pickUnits(raw.daily_units, ARCHIVE_PARAMS.daily),
  };
}

export function buildHistoryPeriods(startDate: string, endDate: string): { start: string; end: string }[] {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const periods: { start: string; end: string }[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const chunkStart = `${year}-01-01`;
    const chunkEnd = `${year}-12-31`;
    periods.push({
      start: chunkStart > startDate ? chunkStart : startDate,
      end: chunkEnd < endDate ? chunkEnd : endDate,
    });
  }
  return periods;
}
