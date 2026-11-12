import { setTimeout as sleep } from 'node:timers/promises';
import { UpstreamError, type UpstreamFailure } from './errors.js';

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  maxDelayMs?: number;
  headers?: Record<string, string>;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/**
 * GET JSON avec timeout, deux nouvelles tentatives maximum sur erreurs
 * transitoires, respect de Retry-After et temporisation exponentielle.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = Math.max(0, options.retries ?? 2);
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const external = options.signal;

  let lastFailure: UpstreamFailure | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (external?.aborted) {
      throw external.reason instanceof Error ? external.reason : new DOMException('Requête annulée', 'AbortError');
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetch(url, {
        signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'meteo-analyse/1.0 (+https://open-meteo.com/)',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const bodyText = await response.text().catch(() => '');
        const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
        let reason: string | undefined;
        if (isJson && bodyText) {
          try {
            const parsed = JSON.parse(bodyText) as { reason?: string; error?: string };
            reason = parsed.reason ?? parsed.error;
          } catch {
            reason = undefined;
          }
        }
        lastFailure = {
          kind: 'http',
          status: response.status,
          reason: reason ?? `HTTP ${response.status}`,
        };

        if (!isRetryableStatus(response.status)) {
          throw new UpstreamError(lastFailure);
        }
        if (attempt === maxRetries) break;

        const delay = Math.min(retryAfter ?? 400 * 2 ** attempt + Math.random() * 150, maxDelayMs);
        await sleep(delay, undefined, { signal: external ?? undefined });
        continue;
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        lastFailure = { kind: 'invalid-json', status: response.status, reason: 'JSON invalide reçu de l’API' };
        throw new UpstreamError(lastFailure, 'Réponse de l’API météo inexploitable.');
      }
    } catch (error) {
      if (error instanceof UpstreamError) {
        if (error.failure.kind === 'invalid-json') throw error;
        lastFailure = error.failure;
      } else if (external?.aborted) {
        throw error;
      } else if (timeoutSignal.aborted) {
        lastFailure = { kind: 'timeout', reason: `Délai de ${timeoutMs} ms dépassé` };
      } else {
        lastFailure = { kind: 'network', reason: (error as Error).message };
      }

      if (attempt === maxRetries) break;
      const delay = Math.min(400 * 2 ** attempt + Math.random() * 150, maxDelayMs);
      await sleep(delay, undefined, { signal: external ?? undefined });
    }
  }

  throw new UpstreamError(lastFailure ?? { kind: 'network', reason: 'Échec inconnu' });
}
