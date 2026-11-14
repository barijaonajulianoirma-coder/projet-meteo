import { computeAnalysis } from '../../shared/analysis.js';
import { HISTORY_SOURCE } from '../../shared/sources.js';
import type { AnalysisPayload } from '../../shared/types.js';
import { createSharedCache, type SharedCache } from '../lib/cache.js';
import { roundCoordinates } from '../lib/coordinates.js';
import { abortable, InflightRequests } from '../lib/inflight.js';
import { getHistory } from './history.js';

export const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;

interface AnalysisComputation {
  payload: AnalysisPayload;
  cachedChunks: number;
  totalChunks: number;
}

/** Deux analyses identiques simultanées partagent collecte et calcul. */
const inflight = new InflightRequests<AnalysisComputation>();

let cachePromise: Promise<SharedCache<AnalysisPayload>> | null = null;

/** Cache créé au premier usage (la connexion Redis éventuelle est paresseuse). */
function cache(): Promise<SharedCache<AnalysisPayload>> {
  cachePromise ??= createSharedCache<AnalysisPayload>('analysis', ANALYSIS_CACHE_TTL_MS, 100);
  return cachePromise;
}

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
  // Une seule valeur arrondie sert de clé de cache et de requête amont.
  const coordinates = roundCoordinates(latitude, longitude);
  const key = analysisCacheKey(coordinates.latitude, coordinates.longitude, startDate, endDate);
  const store = await cache();
  const cached = await store.get(key);
  if (cached) {
    return { payload: cached, cached: true, cachedChunks: 0, totalChunks: 0 };
  }

  const result = await abortable(
    inflight.run(key, async () => {
      const history = await getHistory(coordinates.latitude, coordinates.longitude, startDate, endDate);
      const computation = computeAnalysis(history.payload.daily, history.payload.units, {
        start: startDate,
        end: endDate,
      });

      const payload: AnalysisPayload = {
        kind: 'analysis',
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        timezone: history.payload.timezone,
        timezoneAbbreviation: history.payload.timezoneAbbreviation,
        utcOffsetSeconds: history.payload.utcOffsetSeconds,
        model: 'era5',
        fetchedAt: new Date().toISOString(),
        source: HISTORY_SOURCE,
        ...computation,
      };

      await store.set(key, payload);
      return { payload, cachedChunks: history.cachedChunks, totalChunks: history.totalChunks };
    }),
    signal,
  );

  return {
    payload: result.payload,
    cached: false,
    cachedChunks: result.cachedChunks,
    totalChunks: result.totalChunks,
  };
}

export async function clearAnalysisCache(): Promise<void> {
  if (cachePromise) await (await cachePromise).clear();
}
