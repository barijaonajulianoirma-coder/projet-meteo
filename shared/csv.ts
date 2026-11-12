/** Génération CSV robuste, sans dépendance externe (code partagé serveur/navigateur). */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null;
}

const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Neutralise les formules de tableur (=, +, -, @, tabulation) uniquement pour
 * les champs textuels. Les nombres négatifs restent des nombres.
 */
export function guardFormula(value: string): string {
  if (NUMERIC_RE.test(value)) return value;
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function quote(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  return quote(guardFormula(value));
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((column) => csvCell(column.header)).join(',');
  const lines = rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(','));
  return [header, ...lines].join('\r\n');
}
