import { Router } from 'express';
import { getForecast } from '../services/forecast.js';
import { asyncHandler, clientAbortSignal, parseCoordinates } from './helpers.js';

export function weatherRouter(): Router {
  const router = Router();

  router.get(
    '/weather',
    asyncHandler(async (req, res) => {
      const { latitude, longitude } = parseCoordinates(req.query);
      const signal = clientAbortSignal(res);
      const { payload, cached } = await getForecast(latitude, longitude, signal);

      res.set('X-Cache', cached ? 'HIT' : 'MISS');
      res.set('Cache-Control', 'no-store');
      res.json(payload);
    }),
  );

  return router;
}
