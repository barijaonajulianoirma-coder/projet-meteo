import type { ForecastPayload } from '../../shared/types.js';
import { TtlCache } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';
import { buildForecastUrl, normalizeForecast } from '../lib/openMeteo.js';

export const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new TtlCache<ForecastPayload>(FORECAST_CACHE_TTL_MS, 200);

export function forecastCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}

export interface ForecastResult {
  payload: ForecastPayload;
  cached: boolean;
}

export async function getForecast(latitude: number, longitude: number, signal?: AbortSignal): Promise<ForecastResult> {
  const key = forecastCacheKey(latitude, longitude);
  const cached = cache.get(key);
  if (cached) {
    return { payload: cached, cached: true };
  }

  const raw = await fetchJson<unknown>(buildForecastUrl(latitude, longitude), {
    timeoutMs: 15_000,
    retries: 2,
    signal,
  });
  const payload = normalizeForecast(raw);
  cache.set(key, payload);
  return { payload, cached: false };
}

export function clearForecastCache(): void {
  cache.clear();
}
