import { Router } from 'express';
import { isValidISODate, todayUTC } from '../../shared/dates.js';
import { dateRangeSchema } from '../../shared/schemas.js';
import { ApiError } from '../lib/errors.js';
import { getHistory, maxArchiveEndDate } from '../services/history.js';
import { asyncHandler, clientAbortSignal, parseCoordinates } from './helpers.js';

export const MIN_ARCHIVE_START = '1940-01-01';
export const MAX_RANGE_DAYS = 366 * 40;

export function historyRouter(): Router {
  const router = Router();

  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const { latitude, longitude } = parseCoordinates(req.query);
      const parsed = dateRangeSchema.safeParse({
        start_date: req.query.start_date,
        end_date: req.query.end_date,
      });
      if (!parsed.success) {
        throw new ApiError(400, 'Période invalide', parsed.error.issues.map((issue) => issue.message).join(' ; '));
      }
      const { start_date: startDate, end_date: endDate } = parsed.data;

      if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
        throw new ApiError(400, 'Période invalide', 'Les dates doivent être des dates calendaires réelles (YYYY-MM-DD)');
      }
      if (startDate < MIN_ARCHIVE_START) {
        throw new ApiError(400, 'Période invalide', `L’archive ERA5 démarre au ${MIN_ARCHIVE_START}`);
      }
      const maxEnd = maxArchiveEndDate(todayUTC());
      if (endDate > maxEnd) {
        throw new ApiError(
          400,
          'Période invalide',
          `La fin maximale disponible est le ${maxEnd} : ERA5 est publié avec un délai d’environ 6 jours.`,
        );
      }
      const span = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
      if (span > MAX_RANGE_DAYS) {
        throw new ApiError(400, 'Période invalide', 'La période demandée est trop longue (40 ans maximum).');
      }

      const signal = clientAbortSignal(res);
      const { payload, cachedChunks, totalChunks } = await getHistory(latitude, longitude, startDate, endDate, signal);

      res.set('X-Cache-Chunks', `${cachedChunks}/${totalChunks}`);
      res.set('Cache-Control', 'no-store');
      res.json(payload);
    }),
  );

  return router;
}
