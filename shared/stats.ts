import type { DailyPoint } from './types.js';
import { daysInMonth, enumerateDates, monthKeyOf, parseISODate } from './dates.js';

export const WET_DAY_THRESHOLD_MM = 1;

export interface Coverage {
  available: number;
  total: number;
}

export interface PeriodStatistics {
  /** Nombre de jours fournis dans la sélection. */
  days: number;
  availableTemperatureDays: number;
  availablePrecipitationDays: number;
  meanTemperature: number | null;
  maxTemperature: number | null;
  minTemperature: number | null;
  /** Cumul sur les jours disponibles uniquement. */
  precipitationTotal: number | null;
  precipitationIncomplete: boolean;
  wetDays: number | null;
  wetDaysIncomplete: boolean;
  coverage: {
    temperature: Coverage;
    precipitation: Coverage;
  };
}

export type Aggregation = 'daily' | 'monthly' | 'annual';

export interface AggregateRow {
  key: string;
  label: string;
  days: number;
  expectedDays: number;
  temperatureMean: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitationTotal: number | null;
  precipitationIncomplete: boolean;
  wetDays: number | null;
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function max(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function min(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

export function isPointEmpty(point: DailyPoint): boolean {
  return (
    !isNumber(point.temperatureMean) &&
    !isNumber(point.temperatureMax) &&
    !isNumber(point.temperatureMin) &&
    !isNumber(point.precipitationSum)
  );
}

export function sortAndDedupeDaily(points: DailyPoint[]): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();
  for (const point of points) {
    byDate.set(point.date, point);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function findMissingDays(points: DailyPoint[], start: string, end: string): string[] {
  const known = new Set(points.filter((point) => !isPointEmpty(point)).map((point) => point.date));
  return enumerateDates(start, end).filter((date) => !known.has(date));
}

export function computePeriodStatistics(points: DailyPoint[]): PeriodStatistics {
  const temperaturesMean = points.map((point) => point.temperatureMean).filter(isNumber);
  const temperaturesMax = points.map((point) => point.temperatureMax).filter(isNumber);
  const temperaturesMin = points.map((point) => point.temperatureMin).filter(isNumber);
  const precipitations = points.map((point) => point.precipitationSum).filter(isNumber);

  const precipMissing = points.some((point) => !isNumber(point.precipitationSum));
  const days = points.length;

  return {
    days,
    availableTemperatureDays: temperaturesMean.length,
    availablePrecipitationDays: precipitations.length,
    meanTemperature: mean(temperaturesMean),
    maxTemperature: max(temperaturesMax),
    minTemperature: min(temperaturesMin),
    precipitationTotal: precipitations.length === 0 ? null : precipitations.reduce((total, value) => total + value, 0),
    precipitationIncomplete: precipMissing,
    wetDays: precipitations.length === 0 ? null : precipitations.filter((value) => value >= WET_DAY_THRESHOLD_MM).length,
    wetDaysIncomplete: precipMissing,
    coverage: {
      temperature: { available: temperaturesMean.length, total: days },
      precipitation: { available: precipitations.length, total: days },
    },
  };
}

interface Range {
  start: string;
  end: string;
}

function expectedDaysForMonth(monthKey: string, range?: Range): number {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 0;
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  const start = range && range.start > monthStart ? range.start : monthStart;
  const end = range && range.end < monthEnd ? range.end : monthEnd;
  return enumerateDates(start, end).length;
}

function expectedDaysForYear(yearKey: string, range?: Range): number {
  const yearStart = `${yearKey}-01-01`;
  const yearEnd = `${yearKey}-12-31`;
  const start = range && range.start > yearStart ? range.start : yearStart;
  const end = range && range.end < yearEnd ? range.end : yearEnd;
  return enumerateDates(start, end).length;
}

export function aggregateMonthly(points: DailyPoint[], range?: Range): AggregateRow[] {
  const groups = new Map<string, DailyPoint[]>();
  for (const point of points) {
    const key = monthKeyOf(point.date);
    const existing = groups.get(key);
    if (existing) existing.push(point);
    else groups.set(key, [point]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, group]) => {
      const stats = computePeriodStatistics(group);
      const expectedDays = expectedDaysForMonth(key, range);
      return {
        key,
        label: key,
        days: group.length,
        expectedDays,
        temperatureMean: stats.meanTemperature,
        temperatureMax: stats.maxTemperature,
        temperatureMin: stats.minTemperature,
        precipitationTotal: stats.precipitationTotal,
        precipitationIncomplete: stats.precipitationIncomplete || group.length < expectedDays,
        wetDays: stats.wetDays,
      };
    });
}

export function aggregateAnnual(points: DailyPoint[], range?: Range): AggregateRow[] {
  const groups = new Map<string, DailyPoint[]>();
  for (const point of points) {
    const key = point.date.slice(0, 4);
    const existing = groups.get(key);
    if (existing) existing.push(point);
    else groups.set(key, [point]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, group]) => {
      const stats = computePeriodStatistics(group);
      const expectedDays = expectedDaysForYear(key, range);
      return {
        key,
        label: key,
        days: group.length,
        expectedDays,
        temperatureMean: stats.meanTemperature,
        temperatureMax: stats.maxTemperature,
        temperatureMin: stats.minTemperature,
        precipitationTotal: stats.precipitationTotal,
        precipitationIncomplete: stats.precipitationIncomplete || group.length < expectedDays,
        wetDays: stats.wetDays,
      };
    });
}

/**
 * Moyenne mobile sur 7 jours consécutifs valides.
 * Retourne un tableau aligné sur les points triés ; null si la fenêtre est incomplète.
 */
export function movingAverage7(points: DailyPoint[]): (number | null)[] {
  const sorted = sortAndDedupeDaily(points);
  const result: (number | null)[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    if (index < 6) {
      result.push(null);
      continue;
    }
    const window = sorted.slice(index - 6, index + 1);
    let consecutive = true;
    for (let offset = 1; offset < window.length; offset += 1) {
      const previous = window[offset - 1]!;
      const current = window[offset]!;
      const previousDate = parseISODate(previous.date);
      const expected = new Date(Date.UTC(previousDate.year, previousDate.month - 1, previousDate.day + 1))
        .toISOString()
        .slice(0, 10);
      if (current.date !== expected) {
        consecutive = false;
        break;
      }
    }
    const values = window.map((point) => point.temperatureMean);
    const valid = consecutive && values.every(isNumber);
    result.push(valid ? mean(values as number[]) : null);
  }
  return result;
}

/** Somme des précipitations par jour, utilisée pour l'histogramme. */
export function precipitationSeries(points: DailyPoint[]): { date: string; value: number | null }[] {
  return points.map((point) => ({ date: point.date, value: point.precipitationSum }));
}
