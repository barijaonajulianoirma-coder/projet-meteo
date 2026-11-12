import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { coordinateSchema } from '../../shared/schemas.js';
import { ApiError } from '../lib/errors.js';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function parseCoordinates(query: Request['query']): { latitude: number; longitude: number } {
  const parsed = coordinateSchema.safeParse({
    latitude: query.latitude,
    longitude: query.longitude,
  });
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Coordonnées invalides',
      parsed.error.issues.map((issue) => issue.message).join(' ; '),
    );
  }
  return parsed.data;
}

/** Propage l'annulation du client vers l'appel amont. */
export function clientAbortSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
