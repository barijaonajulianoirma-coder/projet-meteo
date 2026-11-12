import { computeAnalysis } from '../../shared/analysis.js';
import { HISTORY_SOURCE } from '../../shared/sources.js';
import type { AnalysisPayload } from '../../shared/types.js';
import { TtlCache } from '../lib/cache.js';
import { getHistory } from './history.js';

export const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new TtlCache<AnalysisPayload>(ANALYSIS_CACHE_TTL_MS, 100);

export function analysisCacheKey(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
): string {
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${startDate}:${endDate}`;
}

export interface AnalysisResult {
  payload: AnalysisPayload;
  cached: boolean;
  cachedChunks: number;
  totalChunks: number;
}

export async function getAnalysis(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  const key = analysisCacheKey(latitude, longitude, startDate, endDate);
  const cached = cache.get(key);
  if (cached) {
    return { payload: cached, cached: true, cachedChunks: 0, totalChunks: 0 };
  }

  const history = await getHistory(latitude, longitude, startDate, endDate, signal);
  const computation = computeAnalysis(history.payload.daily, history.payload.units, {
    start: startDate,
    end: endDate,
  });

  const payload: AnalysisPayload = {
    kind: 'analysis',
    latitude,
    longitude,
    timezone: history.payload.timezone,
    timezoneAbbreviation: history.payload.timezoneAbbreviation,
    utcOffsetSeconds: history.payload.utcOffsetSeconds,
    model: 'era5',
    fetchedAt: new Date().toISOString(),
    source: HISTORY_SOURCE,
    ...computation,
  };

  cache.set(key, payload);
  return {
    payload,
    cached: false,
    cachedChunks: history.cachedChunks,
    totalChunks: history.totalChunks,
  };
}

export function clearAnalysisCache(): void {
  cache.clear();
}
