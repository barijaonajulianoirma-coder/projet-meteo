/** Erreurs applicatives : le message public ne contient jamais de stack. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UpstreamFailure {
  kind: 'timeout' | 'network' | 'http' | 'invalid-json';
  status?: number;
  reason?: string;
}

export class UpstreamError extends Error {
  constructor(
    public readonly failure: UpstreamFailure,
    message = 'Service météo indisponible ou réponse invalide.',
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function toApiErrorBody(error: unknown): { status: number; body: { error: string; reason?: string } } {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: error.message, reason: error.reason } };
  }
  if (error instanceof UpstreamError) {
    const transient = error.failure.kind !== 'invalid-json';
    return {
      status: transient ? 503 : 502,
      body: {
        error: transient ? 'Service météo momentanément indisponible' : 'Réponse de l’API météo inexploitable',
        reason: error.failure.reason,
      },
    };
  }
  return { status: 500, body: { error: 'Erreur interne du serveur' } };
}
