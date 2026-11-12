const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidISODate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function parseISODate(value: string): { year: number; month: number; day: number } {
  if (!isValidISODate(value)) {
    throw new Error(`Date ISO invalide : ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

export function dateToUTC(value: string): number {
  const { year, month, day } = parseISODate(value);
  return Date.UTC(year, month - 1, day);
}

export function fromUTC(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return fromUTC(dateToUTC(value) + days * 86_400_000);
}

export function subtractDays(value: string, days: number): string {
  return fromUTC(dateToUTC(value) - days * 86_400_000);
}

export function diffInDays(start: string, end: string): number {
  return Math.round((dateToUTC(end) - dateToUTC(start)) / 86_400_000);
}

export function enumerateDates(start: string, end: string): string[] {
  const total = diffInDays(start, end);
  if (total < 0) return [];
  const dates: string[] = [];
  const startTs = dateToUTC(start);
  for (let index = 0; index <= total; index += 1) {
    dates.push(fromUTC(startTs + index * 86_400_000));
  }
  return dates;
}

/** Date du jour en UTC : utilisée comme borne conservatrice pour l'archive. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

export function formatFRDate(date: string): string {
  if (!isValidISODate(date)) return date;
  const { year, month, day } = parseISODate(date);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function formatFRMonth(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return monthKey;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2026-11-10T13:00" -> "10/11 · 13 h" sans passer par le fuseau du navigateur. */
export function formatFRHour(isoLocal: string): string {
  const [datePart, timePart = ''] = isoLocal.split('T');
  const shortDate = isValidISODate(datePart ?? '')
    ? `${datePart!.slice(8, 10)}/${datePart!.slice(5, 7)}`
    : datePart;
  const hour = timePart.slice(0, 2);
  return hour ? `${shortDate} · ${hour} h` : (shortDate ?? isoLocal);
}

export function formatFRWeekday(date: string): string {
  if (!isValidISODate(date)) return date;
  return new Date(dateToUTC(date)).toLocaleDateString('fr-FR', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}
