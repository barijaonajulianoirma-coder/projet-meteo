import { z } from 'zod';

/**
 * Schémas des réponses brutes Open-Meteo.
 * `.passthrough()` autorise les champs supplémentaires : l'API peut en ajouter
 * sans casser la plateforme. Les tableaux peuvent contenir null.
 */

const nullableNumber = z.number().nullable();
const numberArray = z.array(nullableNumber).nullish().transform((value) => value ?? []);

export const forecastResponseSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
    timezone_abbreviation: z.string().nullish().transform((value) => value ?? ''),
    utc_offset_seconds: z.number(),
    current_units: z.record(z.string(), z.string()).nullish().transform((value) => value ?? {}),
    current: z
      .object({
        time: z.string(),
        interval: z.number().nullish().transform((value) => value ?? 0),
        temperature_2m: nullableNumber.nullish().transform((value) => value ?? null),
        relative_humidity_2m: nullableNumber.nullish().transform((value) => value ?? null),
        apparent_temperature: nullableNumber.nullish().transform((value) => value ?? null),
        precipitation: nullableNumber.nullish().transform((value) => value ?? null),
        weather_code: nullableNumber.nullish().transform((value) => value ?? null),
        wind_speed_10m: nullableNumber.nullish().transform((value) => value ?? null),
      })
      .passthrough()
      .nullish()
      .transform((value) => value ?? null),
    hourly_units: z.record(z.string(), z.string()).nullish().transform((value) => value ?? {}),
    hourly: z
      .object({
        time: z.array(z.string()),
        temperature_2m: numberArray,
        relative_humidity_2m: numberArray,
        precipitation_probability: numberArray,
        precipitation: numberArray,
        wind_speed_10m: numberArray,
      })
      .passthrough(),
    daily_units: z.record(z.string(), z.string()).nullish().transform((value) => value ?? {}),
    daily: z
      .object({
        time: z.array(z.string()),
        temperature_2m_mean: numberArray,
        temperature_2m_max: numberArray,
        temperature_2m_min: numberArray,
        precipitation_sum: numberArray,
      })
      .passthrough(),
  })
  .passthrough();

export const archiveResponseSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
    timezone_abbreviation: z.string().nullish().transform((value) => value ?? ''),
    utc_offset_seconds: z.number(),
    daily_units: z.record(z.string(), z.string()).nullish().transform((value) => value ?? {}),
    daily: z
      .object({
        time: z.array(z.string()),
        temperature_2m_mean: numberArray,
        temperature_2m_max: numberArray,
        temperature_2m_min: numberArray,
        precipitation_sum: numberArray,
      })
      .passthrough(),
    error: z.boolean().nullish(),
    reason: z.string().nullish(),
  })
  .passthrough();

export type RawForecast = z.infer<typeof forecastResponseSchema>;
export type RawArchive = z.infer<typeof archiveResponseSchema>;

export const coordinateSchema = z.object({
  latitude: z.coerce.number().min(-90, 'Latitude minimale : -90').max(90, 'Latitude maximale : 90'),
  longitude: z.coerce.number().min(-180, 'Longitude minimale : -180').max(180, 'Longitude maximale : 180'),
});

export const dateRangeSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de début au format YYYY-MM-DD'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de fin au format YYYY-MM-DD'),
  })
  .refine((value) => value.start_date <= value.end_date, {
    message: 'La date de début doit précéder ou égaler la date de fin',
    path: ['start_date'],
  });
