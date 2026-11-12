/**
 * Transformation : réponses Open-Meteo normalisées → observations en format
 * long (une ligne par instant, variable et granularité).
 *
 * Règles :
 * - une valeur absente reste `null`, jamais 0 ;
 * - les séries sont alignées et dédupliquées, une valeur non nulle ne peut pas
 *   être écrasée par un `null` ultérieur ;
 * - l'empreinte de contenu exclut l'heure de collecte : une relance qui ramène
 *   exactement les mêmes données ne crée pas de nouveau snapshot.
 */
import { createHash } from 'node:crypto';
import type { ForecastPayload } from '../shared/types.js';
import type { ArchiveChunkResult } from '../server/lib/openMeteo.js';
import type { Granularity, ObservationRow, SnapKind } from './db.js';

export const FORECAST_SOURCE_ID = 'open-meteo:forecast';
export const ARCHIVE_SOURCE_ID = 'open-meteo:archive-era5';

export interface TransformedSnapshot {
  kind: SnapKind;
  source: string;
  model: string | null;
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  forecastDays: number | null;
  observations: ObservationRow[];
  contentHash: string;
}

interface VariableSpec<T> {
  variable: string;
  pick: (source: T) => number | null | undefined;
}

function normalizeValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeUnit(unit: string | undefined): string | null {
  return unit && unit.trim() !== '' ? unit : null;
}

/** Dernière valeur vue, sauf si elle est nulle alors qu'une valeur existe déjà. */
function dedupe(rows: ObservationRow[]): ObservationRow[] {
  const byKey = new Map<string, ObservationRow>();
  for (const row of rows) {
    const key = `${row.granularity}|${row.validTime}|${row.variable}`;
    const existing = byKey.get(key);
    if (existing && existing.value !== null && row.value === null) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

function contentHash(parts: {
  kind: SnapKind;
  forecastDays: number | null;
  observations: ObservationRow[];
}): string {
  const canonical = {
    kind: parts.kind,
    forecastDays: parts.forecastDays,
    observations: parts.observations.map((row) => [
      row.granularity,
      row.validTime,
      row.variable,
      row.value,
      row.unit,
    ]),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

const CURRENT_VARIABLES: VariableSpec<NonNullable<ForecastPayload['current']>>[] = [
  { variable: 'temperature_2m', pick: (current) => current.temperature },
  { variable: 'apparent_temperature', pick: (current) => current.apparentTemperature },
  { variable: 'relative_humidity_2m', pick: (current) => current.humidity },
  { variable: 'precipitation', pick: (current) => current.precipitation },
  { variable: 'weather_code', pick: (current) => current.weatherCode },
  { variable: 'wind_speed_10m', pick: (current) => current.windSpeed },
];

const HOURLY_VARIABLES: VariableSpec<ForecastPayload['hourly'][number]>[] = [
  { variable: 'temperature_2m', pick: (point) => point.temperature },
  { variable: 'relative_humidity_2m', pick: (point) => point.humidity },
  { variable: 'precipitation_probability', pick: (point) => point.precipitationProbability },
  { variable: 'precipitation', pick: (point) => point.precipitation },
  { variable: 'wind_speed_10m', pick: (point) => point.windSpeed },
];

const DAILY_VARIABLES: VariableSpec<ForecastPayload['daily'][number]>[] = [
  { variable: 'temperature_2m_mean', pick: (point) => point.temperatureMean },
  { variable: 'temperature_2m_max', pick: (point) => point.temperatureMax },
  { variable: 'temperature_2m_min', pick: (point) => point.temperatureMin },
  { variable: 'precipitation_sum', pick: (point) => point.precipitationSum },
];

function pushSeries<T>(
  rows: ObservationRow[],
  granularity: Granularity,
  validTime: string,
  source: T,
  variables: VariableSpec<T>[],
  units: Record<string, string>,
): void {
  for (const { variable, pick } of variables) {
    rows.push({
      granularity,
      validTime,
      variable,
      value: normalizeValue(pick(source)),
      unit: normalizeUnit(units[variable]),
    });
  }
}

export function transformForecast(payload: ForecastPayload, forecastDays: number): TransformedSnapshot {
  const rows: ObservationRow[] = [];

  if (payload.current) {
    pushSeries(
      rows,
      'current',
      payload.current.time,
      payload.current,
      CURRENT_VARIABLES,
      payload.units.current,
    );
  }
  for (const point of payload.hourly) {
    pushSeries(rows, 'hourly', point.time, point, HOURLY_VARIABLES, payload.units.hourly);
  }
  for (const point of payload.daily) {
    pushSeries(rows, 'daily', point.date, point, DAILY_VARIABLES, payload.units.daily);
  }

  const observations = dedupe(rows);
  return {
    kind: 'forecast',
    source: FORECAST_SOURCE_ID,
    model: null,
    timezone: payload.timezone,
    timezoneAbbreviation: payload.timezoneAbbreviation,
    utcOffsetSeconds: payload.utcOffsetSeconds,
    forecastDays,
    observations,
    contentHash: contentHash({ kind: 'forecast', forecastDays, observations }),
  };
}

const ARCHIVE_VARIABLES: VariableSpec<ArchiveChunkResult['daily'][number]>[] = DAILY_VARIABLES;

export function transformArchive(chunks: ArchiveChunkResult[]): TransformedSnapshot {
  if (chunks.length === 0) {
    throw new Error('Aucun fragment d’archive à transformer');
  }

  const first = chunks[0]!;
  const rows: ObservationRow[] = [];
  for (const chunk of chunks) {
    for (const point of chunk.daily) {
      pushSeries(rows, 'daily', point.date, point, ARCHIVE_VARIABLES, chunk.units);
    }
  }

  const observations = dedupe(rows);
  return {
    kind: 'archive',
    source: ARCHIVE_SOURCE_ID,
    model: 'era5',
    timezone: first.timezone,
    timezoneAbbreviation: first.timezoneAbbreviation,
    utcOffsetSeconds: first.utcOffsetSeconds,
    forecastDays: null,
    observations,
    contentHash: contentHash({ kind: 'archive', forecastDays: null, observations }),
  };
}
