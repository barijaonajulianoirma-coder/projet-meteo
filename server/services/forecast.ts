import type { ForecastPayload } from '../../shared/types.js';
import { createSharedCache, type SharedCache } from '../lib/cache.js';
import { roundCoordinates } from '../lib/coordinates.js';
import { fetchJson } from '../lib/http.js';
import { abortable, InflightRequests } from '../lib/inflight.js';
import { buildForecastUrl, normalizeForecast } from '../lib/openMeteo.js';

export const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000;

/** Deux requêtes simultanées sur la même coordonnée partagent l'appel amont. */
const inflight = new InflightRequests<ForecastResult>();

let cachePromise: Promise<SharedCache<ForecastPayload>> | null = null;

/** Cache créé au premier usage (la connexion Redis éventuelle est paresseuse). */
function cache(): Promise<SharedCache<ForecastPayload>> {
  cachePromise ??= createSharedCache<ForecastPayload>('forecast', FORECAST_CACHE_TTL_MS, 200);
  return cachePromise;
}

export function forecastCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}

export interface ForecastResult {
  payload: ForecastPayload;
  cached: boolean;
}

export async function getForecast(latitude: number, longitude: number, signal?: AbortSignal): Promise<ForecastResult> {
  // Une seule valeur arrondie sert à la fois de clé de cache et de requête amont.
  const coordinates = roundCoordinates(latitude, longitude);
  const key = forecastCacheKey(coordinates.latitude, coordinates.longitude);
  const store = await cache();
  const cached = await store.get(key);
  if (cached) {
    return { payload: cached, cached: true };
  }

  return abortable(
    inflight.run(key, async () => {
      const raw = await fetchJson<unknown>(buildForecastUrl(coordinates.latitude, coordinates.longitude), {
        timeoutMs: 15_000,
        retries: 2,
      });
      const payload = normalizeForecast(raw);
      await store.set(key, payload);
      return { payload, cached: false };
    }),
    signal,
  );
}

export async function clearForecastCache(): Promise<void> {
  if (cachePromise) await (await cachePromise).clear();
}
