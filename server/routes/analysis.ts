import { Router } from 'express';
import { getAnalysis } from '../services/analysis.js';
import { parseDateRange } from './dateRange.js';
import { asyncHandler, clientAbortSignal, parseCoordinates } from './helpers.js';

export function analysisRouter(): Router {
  const router = Router();

  router.get(
    '/analysis',
    asyncHandler(async (req, res) => {
      const { latitude, longitude } = parseCoordinates(req.query);
      const { startDate, endDate } = parseDateRange(req.query);

      const signal = clientAbortSignal(res);
      const { payload, cached, cachedChunks, totalChunks } = await getAnalysis(
        latitude,
        longitude,
        startDate,
        endDate,
        signal,
      );

      res.set('X-Cache', cached ? 'HIT' : 'MISS');
      if (!cached && totalChunks > 0) {
        res.set('X-Cache-Chunks', `${cachedChunks}/${totalChunks}`);
      }
      res.set('Cache-Control', 'no-store');
      res.json(payload);
    }),
  );

  return router;
}
