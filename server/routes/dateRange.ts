import type { Request } from 'express';
import { isValidISODate, todayUTC } from '../../shared/dates.js';
import { dateRangeSchema } from '../../shared/schemas.js';
import { ApiError } from '../lib/errors.js';
import { maxArchiveEndDate } from '../services/history.js';

export const MIN_ARCHIVE_START = '1940-01-01';
export const MAX_RANGE_DAYS = 366 * 40;

/**
 * Valide les paramètres `start_date`/`end_date` d'une requête d'archive.
 * Règles partagées par `/history` et `/analysis` : dates calendaires réelles,
 * début après 1940-01-01, fin au plus tard à aujourd'hui − 6 jours, période
 * de 40 ans maximum. Lève une `ApiError` 400 explicite en cas de refus.
 */
export function parseDateRange(query: Request['query']): { startDate: string; endDate: string } {
  const parsed = dateRangeSchema.safeParse({
    start_date: query.start_date,
    end_date: query.end_date,
  });
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Période invalide',
      parsed.error.issues.map((issue) => issue.message).join(' ; '),
    );
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

  return { startDate, endDate };
}
