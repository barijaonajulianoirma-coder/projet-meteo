/**
 * Extraction : appels Open-Meteo centralisés, avec timeout, reprises et
 * temporisation gérées par `server/lib/http.ts`.
 * L'archive est découpée par année pour rester sous les limites de l'API.
 */
import { ARCHIVE_SAFETY_DAYS } from '../shared/sources.js';
import { todayUTC } from '../shared/dates.js';
import type { ForecastPayload } from '../shared/types.js';
import { mapWithConcurrency } from '../server/lib/concurrency.js';
import { fetchJson } from '../server/lib/http.js';
import {
  buildArchiveUrl,
  buildForecastUrl,
  buildHistoryPeriods,
  normalizeArchive,
  normalizeForecast,
  type ArchiveChunkResult,
} from '../server/lib/openMeteo.js';

export const ETL_FORECAST_TIMEOUT_MS = 20_000;
export const ETL_ARCHIVE_TIMEOUT_MS = 30_000;
export const ETL_ARCHIVE_CONCURRENCY = 2;

export type ForecastFetcher = (
  latitude: number,
  longitude: number,
  forecastDays: number,
) => Promise<ForecastPayload>;

export type ArchiveFetcher = (
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
) => Promise<ArchiveChunkResult[]>;

export async function fetchForecast(
  latitude: number,
  longitude: number,
  forecastDays: number,
): Promise<ForecastPayload> {
  const raw = await fetchJson<unknown>(buildForecastUrl(latitude, longitude, forecastDays), {
    timeoutMs: ETL_FORECAST_TIMEOUT_MS,
    retries: 3,
  });
  return normalizeForecast(raw);
}

export async function fetchArchiveWindow(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
): Promise<ArchiveChunkResult[]> {
  const periods = buildHistoryPeriods(startDate, endDate);
  const results = await mapWithConcurrency(periods, ETL_ARCHIVE_CONCURRENCY, async (period) => {
    try {
      const raw = await fetchJson<unknown>(buildArchiveUrl(latitude, longitude, period.start, period.end), {
        timeoutMs: ETL_ARCHIVE_TIMEOUT_MS,
        retries: 3,
      });
      return { chunk: normalizeArchive(raw), error: null as Error | null };
    } catch (error) {
      return { chunk: null, error: error instanceof Error ? error : new Error('Erreur inconnue') };
    }
  });

  const chunks: ArchiveChunkResult[] = [];
  for (const result of results) {
    if (result.error || !result.chunk) {
      throw new Error(`Archive ERA5 indisponible : ${result.error?.message ?? 'fragment vide'}`);
    }
    chunks.push(result.chunk);
  }
  return chunks;
}

/**
 * Fenêtre d'archive par défaut : les N derniers jours complets, en respectant
 * le délai de publication d'ERA5 (marge opérationnelle, pas une garantie).
 */
export function archiveWindow(days: number, today = todayUTC()): { start: string; end: string } {
  if (days <= 0) throw new Error('La fenêtre d’archive doit être strictement positive');
  const endMs = Date.parse(`${today}T00:00:00Z`) - ARCHIVE_SAFETY_DAYS * 86_400_000;
  const end = new Date(endMs).toISOString().slice(0, 10);
  const start = new Date(endMs - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}
