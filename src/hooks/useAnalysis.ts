import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisPayload } from '../../shared/types.js';
import { errorMessage, getAnalysis } from '../api.js';
import type { Coordinates } from '../coordinates.js';

export interface AnalysisState {
  data: AnalysisPayload | null;
  loading: boolean;
  error: string | null;
}

export interface UseAnalysisResult {
  state: AnalysisState;
  load: (coordinates: Coordinates, startDate: string, endDate: string) => void;
  cancel: () => void;
}

export function useAnalysis(): UseAnalysisResult {
  const [state, setState] = useState<AnalysisState>({
    data: null,
    loading: false,
    error: null,
  });
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState((previous) => ({ ...previous, loading: false }));
  }, []);

  const load = useCallback((coordinates: Coordinates, startDate: string, endDate: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    setState((previous) => ({
      data: previous.data,
      loading: true,
      error: null,
    }));

    void getAnalysis(
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
        setState((previous) => ({
          data: previous.data,
          loading: false,
          error: errorMessage(error),
        }));
      });
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return { state, load, cancel };
}
