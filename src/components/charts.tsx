import type { TooltipProps } from 'recharts';
import { formatNumber, MISSING_VALUE } from '../lib/format.js';

/**
 * Primitives communes aux graphiques Recharts : palette alignée sur la feuille
 * de style, axes/grilles homogènes, infobulle lisible et histogrammes.
 */

export const CHART = {
  temperature: '#fb7185',
  tempMax: '#fbbf24',
  tempMin: '#38bdf8',
  tempMean: '#a78bfa',
  precip: '#38bdf8',
  humidity: '#22d3ee',
  wind: '#94a3b8',
  probability: '#34d399',
  accent: '#4c9aff',
  neutral: '#94a3b8',
  grid: 'rgba(148, 163, 184, 0.16)',
  axis: '#8fa3bf',
} as const;

/** Propriétés d'axe communes (libellés discrets, pas de lignes parasites). */
export const chartAxis = {
  tick: { fontSize: 11, fill: CHART.axis },
  tickLine: false,
  axisLine: false,
} as const;

export const chartGrid = {
  stroke: CHART.grid,
  strokeDasharray: '3 3',
  vertical: false,
} as const;

export const chartLegend = {
  iconType: 'circle',
  iconSize: 8,
  wrapperStyle: { fontSize: 11, paddingTop: 6 },
} as const;

/** Dégradé vertical pour les courbes en aire. */
export function AreaGradient({
  id,
  color,
  from = 0.4,
  to = 0.02,
}: {
  id: string;
  color: string;
  from?: number;
  to?: number;
}): JSX.Element {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={from} />
        <stop offset="100%" stopColor={color} stopOpacity={to} />
      </linearGradient>
    </defs>
  );
}

/** Dégradé vertical pour les barres et histogrammes. */
export function BarGradient({ id, color }: { id: string; color: string }): JSX.Element {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={1} />
        <stop offset="100%" stopColor={color} stopOpacity={0.32} />
      </linearGradient>
    </defs>
  );
}

/**
 * Infobulle commune : libellé en tête, puis une ligne par série avec pastille
 * de couleur, nom et valeur formatée. L'unité provient de la prop `unit` de la
 * série Recharts (`<Line unit=" °C" />`).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: TooltipProps<number, string> & {
  labelFormatter?: (label: string) => string;
}): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const heading = label === undefined || label === null ? '' : String(label);
  return (
    <div className="custom-tooltip chart-tooltip">
      {heading !== '' && (
        <p className="tooltip-label">{labelFormatter ? labelFormatter(heading) : heading}</p>
      )}
      <ul className="tooltip-rows">
        {payload.map((entry) => {
          const unit = entry.unit === undefined || entry.unit === '' ? '' : ` ${String(entry.unit)}`;
          return (
            <li key={String(entry.dataKey)}>
              <span
                className="tooltip-dot"
                style={{ background: entry.color ?? CHART.accent }}
                aria-hidden="true"
              />
              <span className="tooltip-name">{entry.name}</span>
              <span className="tooltip-value">
                {typeof entry.value === 'number' ? `${formatNumber(entry.value)}${unit}` : MISSING_VALUE}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface HistogramBin {
  /** Identifiant stable pour React. */
  key: string;
  /** Libellé affiché sur l'axe des abscisses. */
  label: string;
  lower: number;
  upper: number;
  count: number;
}

/**
 * Construit un histogramme à classes de largeur constante.
 * Les valeurs manquantes (`null`) et non finies sont ignorées.
 */
export function buildHistogram(
  values: readonly (number | null)[],
  binCount = 8,
  digits: 0 | 1 = 1,
): HistogramBin[] {
  const clean = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0 || binCount < 1) return [];

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min;

  if (span === 0) {
    return [{ key: 'bin-0', label: formatNumber(min, digits), lower: min, upper: max, count: clean.length }];
  }

  const width = span / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, index) => {
    const lower = min + index * width;
    const upper = index === binCount - 1 ? max : lower + width;
    return {
      key: `bin-${index}`,
      label: `${formatNumber(lower, digits)}–${formatNumber(upper, digits)}`,
      lower,
      upper,
      count: 0,
    };
  });

  for (const value of clean) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    const bin = bins[index];
    if (bin) bin.count += 1;
  }

  return bins;
}
