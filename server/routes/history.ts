import { Router } from 'express';
import { getHistory } from '../services/history.js';
import { parseDateRange } from './dateRange.js';
import { asyncHandler, clientAbortSignal, parseCoordinates } from './helpers.js';

export function historyRouter(): Router {
  const router = Router();

  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const { latitude, longitude } = parseCoordinates(req.query);
      const { startDate, endDate } = parseDateRange(req.query);

      const signal = clientAbortSignal(res);
      const { payload, cachedChunks, totalChunks } = await getHistory(latitude, longitude, startDate, endDate, signal);

      res.set('X-Cache-Chunks', `${cachedChunks}/${totalChunks}`);
      res.set('Cache-Control', 'no-store');
      res.json(payload);
    }),
  );

  return router;
}
