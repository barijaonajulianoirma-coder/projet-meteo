import { isValidISODate, parseISODate } from '../../shared/dates.js';
import type { UnitMap } from '../../shared/types.js';

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export const MISSING_VALUE = '—';

export function formatNumber(value: number | null | undefined, digits: 0 | 1 = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MISSING_VALUE;
  return digits === 0 ? integerFormat.format(value) : numberFormat.format(value);
}

const scientificFormat = new Intl.NumberFormat('fr-FR', {
  maximumSignificantDigits: 3,
  notation: 'scientific',
});

const preciseFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

/** Affiche une p-value de façon lisible (scientifique sous 0,001). */
export function formatPValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MISSING_VALUE;
  if (value < 0.001) return scientificFormat.format(value);
  return preciseFormat.format(value);
}

export function unitOf(units: UnitMap | undefined, key: string): string {
  return units?.[key] ?? '';
}

export function withUnit(value: number | null | undefined, unit: string, digits: 0 | 1 = 1): string {
  const formatted = formatNumber(value, digits);
  return formatted === MISSING_VALUE ? formatted : `${formatted}${unit ? ` ${unit}` : ''}`;
}

/** Affiche un horodatage UTC dans le fuseau du lieu, sans passer par celui du navigateur. */
export function formatUtcInOffset(isoUtc: string, offsetSeconds: number): string {
  const timestamp = Date.parse(isoUtc);
  if (Number.isNaN(timestamp)) return isoUtc;
  const shifted = new Date(timestamp + offsetSeconds * 1000);
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const year = shifted.getUTCFullYear();
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} à ${hours}:${minutes}`;
}

export function formatOffset(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const absolute = Math.abs(offsetSeconds);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return MISSING_VALUE;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

export function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Date locale du lieu au format long, sans décalage. */
export function formatLongDate(date: string): string {
  if (!isValidISODate(date)) return date;
  const { year, month, day } = parseISODate(date);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
