import { diffInDays, subtractDays } from '../../shared/dates.js';
import { HISTORY_SOURCE } from '../../shared/sources.js';
import { findMissingDays, isPointEmpty, sortAndDedupeDaily } from '../../shared/stats.js';
import type { DailyPoint, HistoryPayload, HistoryPeriod, UnitMap } from '../../shared/types.js';
import { TtlCache } from '../lib/cache.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { ApiError, UpstreamError } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';
import { buildArchiveUrl, buildHistoryPeriods, normalizeArchive, type ArchiveChunkResult } from '../lib/openMeteo.js';

export const ARCHIVE_CACHE_TTL_MS = 60 * 60 * 1000;
export const ARCHIVE_CONCURRENCY = 3;
export const ARCHIVE_SAFETY_DAYS = 6;

const chunkCache = new TtlCache<ArchiveChunkResult>(ARCHIVE_CACHE_TTL_MS, 1000);

export function chunkCacheKey(latitude: number, longitude: number, start: string, end: string): string {
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${start}:${end}`;
}

export interface HistoryResult {
  payload: HistoryPayload;
  cachedChunks: number;
  totalChunks: number;
}

/** Fin maximale proposée pour ERA5 : marge opérationnelle, pas une garantie. */
export function maxArchiveEndDate(todayUtc: string): string {
  return subtractDays(todayUtc, ARCHIVE_SAFETY_DAYS);
}

export async function getHistory(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<HistoryResult> {
  const periods = buildHistoryPeriods(startDate, endDate);
  const firstError: unknown[] = [];
  let cachedChunks = 0;

  const results = await mapWithConcurrency(periods, ARCHIVE_CONCURRENCY, async (period) => {
    const key = chunkCacheKey(latitude, longitude, period.start, period.end);
    const cached = chunkCache.get(key);
    if (cached) {
      cachedChunks += 1;
      return { period, chunk: cached, error: null as Error | null };
    }
    try {
      const raw = await fetchJson<unknown>(buildArchiveUrl(latitude, longitude, period.start, period.end), {
        timeoutMs: 20_000,
        retries: 2,
        signal,
      });
      const chunk = normalizeArchive(raw);
      chunkCache.set(key, chunk);
      return { period, chunk, error: null as Error | null };
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      firstError.push(error);
      const message =
        error instanceof ApiError
          ? `${error.message}${error.reason ? ` — ${error.reason}` : ''}`
          : error instanceof UpstreamError
            ? (error.failure.reason ?? error.message)
            : 'Erreur inconnue pendant la collecte';
      return { period, chunk: null, error: new Error(message) };
    }
  });

  const statuses: HistoryPeriod[] = [];
  const byDate = new Map<string, DailyPoint>();
  const duplicateDates = new Set<string>();
  let timezone = 'UTC';
  let timezoneAbbreviation = 'UTC';
  let utcOffsetSeconds = 0;
  let units: UnitMap = {};
  let hasMeta = false;

  for (const result of results) {
    if (!result.chunk) {
      statuses.push({
        start: result.period.start,
        end: result.period.end,
        status: 'error',
        message: result.error?.message ?? 'Période indisponible',
      });
      continue;
    }

    if (!hasMeta) {
      timezone = result.chunk.timezone;
      timezoneAbbreviation = result.chunk.timezoneAbbreviation;
      utcOffsetSeconds = result.chunk.utcOffsetSeconds;
      units = result.chunk.units;
      hasMeta = true;
    }

    let nonEmpty = 0;
    for (const point of result.chunk.daily) {
      if (byDate.has(point.date)) duplicateDates.add(point.date);
      byDate.set(point.date, point);
      if (!isPointEmpty(point)) nonEmpty += 1;
    }

    statuses.push({
      start: result.period.start,
      end: result.period.end,
      status: nonEmpty === 0 ? 'empty' : 'ok',
    });
  }

  if (!hasMeta) {
    const failure = firstError[0];
    if (failure) throw failure;
    throw new ApiError(502, 'Aucune donnée d’archive disponible', 'Toutes les périodes ont échoué');
  }

  const daily = sortAndDedupeDaily([...byDate.values()]);
  const expectedDays = diffInDays(startDate, endDate) + 1;
  const missingDays = findMissingDays(daily, startDate, endDate);

  return {
    payload: {
      kind: 'history',
      latitude,
      longitude,
      timezone,
      timezoneAbbreviation,
      utcOffsetSeconds,
      units,
      model: 'era5',
      daily,
      expectedDays,
      availableDays: expectedDays - missingDays.length,
      missingDays,
      duplicateDays: [...duplicateDates].sort(),
      periods: statuses,
      fetchedAt: new Date().toISOString(),
      source: HISTORY_SOURCE,
    },
    cachedChunks,
    totalChunks: periods.length,
  };
}

export function clearHistoryCache(): void {
  chunkCache.clear();
}
