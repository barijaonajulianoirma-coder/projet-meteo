import type { AnalysisPayload, ApiErrorBody, ForecastPayload, HistoryPayload } from '../shared/types.js';

const JSON_HEADERS = { accept: 'application/json' };

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: JSON_HEADERS, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError('Le serveur est injoignable. Vérifiez que l’API est démarrée.', 0);
  }

  if (!response.ok) {
    let body: ApiErrorBody | null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    throw new ApiRequestError(
      body?.error ?? `Erreur HTTP ${response.status}`,
      response.status,
      body?.reason,
    );
  }

  return (await response.json()) as T;
}

export function getWeather(
  coordinates: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<ForecastPayload> {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
  });
  return request<ForecastPayload>(`/api/weather?${params.toString()}`, signal);
}

export function getHistory(
  coordinates: { latitude: number; longitude: number },
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<HistoryPayload> {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    start_date: startDate,
    end_date: endDate,
  });
  return request<HistoryPayload>(`/api/history?${params.toString()}`, signal);
}

export function getAnalysis(
  coordinates: { latitude: number; longitude: number },
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<AnalysisPayload> {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    start_date: startDate,
    end_date: endDate,
  });
  return request<AnalysisPayload>(`/api/analysis?${params.toString()}`, signal);
}

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
  username: string | null;
}

export async function getAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status', { headers: JSON_HEADERS, signal });
  if (!response.ok) {
    // Serveur sans authentification : comportement historique, accès libre.
    if (response.status === 404) return { required: false, authenticated: true, username: null };
    throw new ApiRequestError(`Erreur HTTP ${response.status}`, response.status);
  }
  return (await response.json()) as AuthStatus;
}

export async function login(username: string, password: string): Promise<AuthStatus> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    let body: ApiErrorBody | null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    throw new ApiRequestError(
      body?.error ?? 'Connexion refusée',
      response.status,
      body?.reason,
    );
  }
  return (await response.json()) as AuthStatus;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: JSON_HEADERS });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.reason ? `${error.message} — ${error.reason}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Erreur inconnue';
}
