import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryPayload } from '../../shared/types.js';
import { errorMessage, getHistory } from '../api.js';
import type { Coordinates } from '../coordinates.js';

export interface HistoryState {
  data: HistoryPayload | null;
  loading: boolean;
  error: string | null;
}

export interface UseHistoryResult {
  state: HistoryState;
  load: (coordinates: Coordinates, startDate: string, endDate: string) => void;
  cancel: () => void;
  /** Annule la requête en cours et oublie les données chargées. */
  reset: () => void;
}

export function useHistory(): UseHistoryResult {
  const [state, setState] = useState<HistoryState>({ data: null, loading: false, error: null });
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    requestIdRef.current += 1;
    setState((previous) => ({ ...previous, loading: false }));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestIdRef.current += 1;
    setState({ data: null, loading: false, error: null });
  }, []);

  const load = useCallback((coordinates: Coordinates, startDate: string, endDate: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    setState((previous) => ({ ...previous, loading: true, error: null }));

    getHistory(
      { latitude: coordinates.latitude, longitude: coordinates.longitude },
      startDate,
      endDate,
      controller.signal,
    )
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setState((previous) => ({ data: previous.data, loading: false, error: errorMessage(error) }));
      });
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return { state, load, cancel, reset };
}
