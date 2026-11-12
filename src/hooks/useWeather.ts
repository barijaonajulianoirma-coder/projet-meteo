import { useCallback, useEffect, useRef, useState } from 'react';
import type { ForecastPayload } from '../../shared/types.js';
import { errorMessage, getWeather } from '../api.js';
import type { Coordinates } from '../coordinates.js';

export const AUTO_REFRESH_MS = 15 * 60 * 1000;

export interface WeatherState {
  data: ForecastPayload | null;
  loading: boolean;
  error: string | null;
  /** true lorsque des données plus anciennes sont conservées après un échec. */
  stale: boolean;
}

export interface UseWeatherResult {
  state: WeatherState;
  refresh: () => void;
}

export function useWeather(coordinates: Coordinates): UseWeatherResult {
  const [state, setState] = useState<WeatherState>({
    data: null,
    loading: true,
    error: null,
    stale: false,
  });
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;

      setState((previous) => ({
        ...previous,
        loading: mode === 'initial' || previous.data === null,
        error: null,
      }));

      try {
        const data = await getWeather(
          { latitude: coordinates.latitude, longitude: coordinates.longitude },
          controller.signal,
        );
        if (requestIdRef.current !== requestId) return;
        setState({ data, loading: false, error: null, stale: false });
      } catch (error) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setState((previous) => ({
          data: previous.data,
          loading: false,
          error: errorMessage(error),
          stale: previous.data !== null,
        }));
      }
    },
    [coordinates.latitude, coordinates.longitude],
  );

  useEffect(() => {
    void load('initial');

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load('refresh');
    }, AUTO_REFRESH_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load('refresh');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controllerRef.current?.abort();
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load('refresh');
  }, [load]);

  return { state, refresh };
}
