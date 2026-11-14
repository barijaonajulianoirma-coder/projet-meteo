/**
 * Moteur d'analyse statistique et économétrique.
 *
 * Toutes les fonctions sont pures et utilisables côté serveur (aucun accès DOM).
 * Les valeurs manquantes ne sont jamais remplacées : les observations
 * incomplètes sont exclues des calculs concernés et les effectifs sont exposés.
 */
import { addDays, dateToUTC, diffInDays } from './dates.js';
import {
  aggregateMonthly,
  sortAndDedupeDaily,
  WET_DAY_THRESHOLD_MM,
  type AggregateRow,
} from './stats.js';
import type {
  AdfResult,
  AnalysisComputation,
  AnalysisForecastPoint,
  ClimatologyRow,
  ConfidenceInterval,
  DescriptiveStats,
  DecompositionPoint,
  ExtremeEvent,
  ExtremesSummary,
  HoltWintersResult,
  MannKendallResult,
  MlFeature,
  MlMetrics,
  MlResult,
  OlsCoefficient,
  OlsResult,
  SeasonalDecomposition,
  SerialCorrelationPoint,
  UnitMap,
  DailyPoint,
} from './types.js';

const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

const DAY_MS = 86_400_000;

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function meanValue(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function medianValue(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function quantile(sorted: number[], probability: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
}

/* ── Lois de probabilité (p-values, intervalles) ────────────────────── */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function logGamma(value: number): number {
  if (value < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const x = value - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let index = 0; index < LANCZOS.length; index += 1) {
    a += LANCZOS[index]! / (x + index + 1);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITERATIONS = 200;
  const EPSILON = 3e-12;
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const m2 = 2 * iteration;
    let aa = (iteration * (b - iteration) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    aa = -((a + iteration) * (qab + iteration) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (factor * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b;
}

function studentTCdf(t: number, degrees: number): number {
  if (!Number.isFinite(t) || degrees <= 0) return Number.NaN;
  const x = degrees / (degrees + t * t);
  const tail = 0.5 * regularizedBeta(x, degrees / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

function fDistributionPValue(statistic: number, df1: number, df2: number): number | null {
  if (!Number.isFinite(statistic) || statistic < 0 || df1 <= 0 || df2 <= 0) return null;
  const cdf = regularizedBeta((df1 * statistic) / (df1 * statistic + df2), df1 / 2, df2 / 2);
  return Math.min(1, Math.max(0, 1 - cdf));
}

function tCritical95(degrees: number): number {
  if (degrees <= 0) return Number.NaN;
  let low = 0;
  let high = 12;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (studentTCdf(middle, degrees) < 0.975) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function normalCdf(value: number): number {
  // Approximation d'Abramowitz & Stegun 7.1.26 (erreur < 1,5e-7).
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - polynomial * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/* ── Algèbre linéaire ───────────────────────────────────────────────── */

type Matrix = number[][];

function transpose(matrix: Matrix): Matrix {
  return matrix[0]!.map((_, column) => matrix.map((row) => row[column]!));
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const result: Matrix = [];
  for (let row = 0; row < left.length; row += 1) {
    const output: number[] = [];
    for (let column = 0; column < right[0]!.length; column += 1) {
      let total = 0;
      for (let index = 0; index < right.length; index += 1) {
        total += left[row]![index]! * right[index]![column]!;
      }
      output.push(total);
    }
    result.push(output);
  }
  return result;
}

function multiplyMatrixVector(matrix: Matrix, vector: number[]): number[] {
  return matrix.map((row) => row.reduce((total, value, index) => total + value * vector[index]!, 0));
}

function invertMatrix(matrix: Matrix): Matrix | null {
  const size = matrix.length;
  if (size === 0) return null;
  const augmented: Matrix = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0)),
  ]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotValue = Math.abs(augmented[column]![column]!);
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(augmented[row]![column]!);
      if (candidate > pivotValue) {
        pivotValue = candidate;
        pivotRow = row;
      }
    }
    if (pivotValue < 1e-10) return null;
    if (pivotRow !== column) {
      const temporary = augmented[column]!;
      augmented[column] = augmented[pivotRow]!;
      augmented[pivotRow] = temporary;
    }
    const pivot = augmented[column]![column]!;
    for (let index = 0; index < size * 2; index += 1) {
      augmented[column]![index] = augmented[column]![index]! / pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor === 0) continue;
      for (let index = 0; index < size * 2; index += 1) {
        augmented[row]![index] = augmented[row]![index]! - factor * augmented[column]![index]!;
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

/* ── Statistiques descriptives ──────────────────────────────────────── */

export function describeSeries(
  variable: DescriptiveStats['variable'],
  label: string,
  unit: string,
  values: (number | null)[],
): DescriptiveStats {
  const valid = values.filter(isNumber).sort((a, b) => a - b);
  const count = valid.length;
  const mean = meanValue(valid);
  let standardDeviation: number | null = null;
  if (count > 1 && mean !== null) {
    const sumSquares = valid.reduce((total, value) => total + (value - mean) ** 2, 0);
    standardDeviation = Math.sqrt(sumSquares / (count - 1));
  }

  let skewness: number | null = null;
  let kurtosis: number | null = null;
  if (count > 3 && mean !== null) {
    let m2 = 0;
    let m3 = 0;
    let m4 = 0;
    for (const value of valid) {
      const deviation = value - mean;
      m2 += deviation ** 2;
      m3 += deviation ** 3;
      m4 += deviation ** 4;
    }
    m2 /= count;
    m3 /= count;
    m4 /= count;
    if (m2 > 0) {
      skewness = m3 / m2 ** 1.5;
      kurtosis = m4 / m2 ** 2 - 3;
    }
  }

  let meanCi95: ConfidenceInterval | null = null;
  if (count > 1 && mean !== null && standardDeviation !== null) {
    const critical = tCritical95(count - 1);
    const margin = critical * (standardDeviation / Math.sqrt(count));
    meanCi95 = { lower: mean - margin, upper: mean + margin };
  }

  return {
    variable,
    label,
    unit,
    count,
    missing: values.length - count,
    mean,
    median: medianValue(valid),
    standardDeviation,
    minimum: count > 0 ? valid[0]! : null,
    maximum: count > 0 ? valid[count - 1]! : null,
    quartile1: quantile(valid, 0.25),
    quartile3: quantile(valid, 0.75),
    skewness,
    kurtosis,
    meanCi95,
    coefficientOfVariation:
      variable === 'precipitation' && mean !== null && mean !== 0 && standardDeviation !== null
        ? standardDeviation / mean
        : null,
  };
}

/* ── Corrélations ───────────────────────────────────────────────────── */

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const meanLeft = meanValue(left);
  const meanRight = meanValue(right);
  if (meanLeft === null || meanRight === null) return null;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const deviationLeft = left[index]! - meanLeft;
    const deviationRight = right[index]! - meanRight;
    covariance += deviationLeft * deviationRight;
    varianceLeft += deviationLeft ** 2;
    varianceRight += deviationRight ** 2;
  }
  if (varianceLeft === 0 || varianceRight === 0) return null;
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array.from({ length: values.length }, () => 0);
  let position = 0;
  while (position < order.length) {
    let end = position;
    while (end + 1 < order.length && order[end + 1]!.value === order[position]!.value) end += 1;
    const averageRank = (position + end) / 2 + 1;
    for (let index = position; index <= end; index += 1) {
      result[order[index]!.index] = averageRank;
    }
    position = end + 1;
  }
  return result;
}

function spearman(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  return pearson(ranks(left), ranks(right));
}

function pairwiseCorrelation(points: DailyPoint[]): {
  pearson: number | null;
  spearman: number | null;
  n: number;
} {
  const temperatures: number[] = [];
  const precipitations: number[] = [];
  for (const point of points) {
    if (isNumber(point.temperatureMean) && isNumber(point.precipitationSum)) {
      temperatures.push(point.temperatureMean);
      precipitations.push(point.precipitationSum);
    }
  }
  return {
    pearson: pearson(temperatures, precipitations),
    spearman: spearman(temperatures, precipitations),
    n: temperatures.length,
  };
}

/* ── Régression linéaire (OLS) ──────────────────────────────────────── */

function ols(
  target: string,
  outcome: number[],
  design: Matrix,
  names: string[],
  labels: string[],
): OlsResult | null {
  const n = outcome.length;
  const parameters = design[0]?.length ?? 0;
  if (n === 0 || parameters === 0 || n <= parameters + 2) return null;
  if (design.some((row) => row.length !== parameters)) return null;

  const transposed = transpose(design);
  const xtx = multiplyMatrices(transposed, design);
  const xty = multiplyMatrixVector(transposed, outcome);
  const inverse = invertMatrix(xtx);
  if (!inverse) return null;

  const coefficients = multiplyMatrixVector(inverse, xty);
  const fitted = design.map((row) => row.reduce((total, value, index) => total + value * coefficients[index]!, 0));
  const residuals = outcome.map((value, index) => value - fitted[index]!);
  const sse = residuals.reduce((total, value) => total + value ** 2, 0);
  const meanOutcome = meanValue(outcome);
  if (meanOutcome === null) return null;
  const sst = outcome.reduce((total, value) => total + (value - meanOutcome) ** 2, 0);
  const degreesOfFreedom = n - parameters;
  if (degreesOfFreedom <= 0 || sst === 0) return null;

  const r2 = 1 - sse / sst;
  const adjustedR2 = 1 - (1 - r2) * ((n - 1) / degreesOfFreedom);
  const mse = sse / degreesOfFreedom;
  const residualStandardError = Math.sqrt(mse);
  const critical = tCritical95(degreesOfFreedom);

  const results: OlsCoefficient[] = coefficients.map((estimate, index) => {
    const variance = mse * inverse[index]![index]!;
    const stdError = variance >= 0 ? Math.sqrt(variance) : null;
    const tStatistic = stdError && stdError > 0 ? estimate / stdError : null;
    const pValue =
      tStatistic === null ? null : Math.min(1, Math.max(0, 2 * (1 - studentTCdf(Math.abs(tStatistic), degreesOfFreedom))));
    return {
      name: names[index] ?? `x${index}`,
      label: labels[index] ?? names[index] ?? `x${index}`,
      estimate,
      stdError,
      tStatistic,
      pValue,
      ci95:
        stdError === null
          ? null
          : { lower: estimate - critical * stdError, upper: estimate + critical * stdError },
    };
  });

  const explainedVariance = r2 / (parameters - 1);
  const unexplainedVariance = (1 - r2) / degreesOfFreedom;
  const fStatistic =
    parameters > 1 && unexplainedVariance > 0 ? explainedVariance / unexplainedVariance : null;

  let durbinWatson: number | null = null;
  if (sse > 0 && residuals.length > 1) {
    let sumDiffSquares = 0;
    for (let index = 1; index < residuals.length; index += 1) {
      sumDiffSquares += (residuals[index]! - residuals[index - 1]!) ** 2;
    }
    durbinWatson = sumDiffSquares / sse;
  }

  return {
    target,
    n,
    parameters,
    r2,
    adjustedR2,
    fStatistic,
    fPValue:
      fStatistic === null ? null : fDistributionPValue(fStatistic, parameters - 1, degreesOfFreedom),
    residualStandardError,
    durbinWatson,
    coefficients: results,
  };
}

function econometricModel(points: DailyPoint[]): OlsResult | null {
  const rows = points.filter((point) => isNumber(point.temperatureMean));
  if (rows.length < 730) return null;

  const observedMonths = new Set(rows.map((point) => Number(point.date.slice(5, 7))));
  if (observedMonths.size < 12) return null;

  const firstDate = rows[0]!.date;
  const origin = dateToUTC(firstDate);
  const design: Matrix = [];
  const outcome: number[] = [];
  for (const point of rows) {
    const temperature = point.temperatureMean;
    if (!isNumber(temperature)) continue;
    const years = (dateToUTC(point.date) - origin) / (365.25 * DAY_MS);
    const month = Number(point.date.slice(5, 7));
    const row = [1, years];
    for (let candidate = 2; candidate <= 12; candidate += 1) {
      row.push(month === candidate ? 1 : 0);
    }
    design.push(row);
    outcome.push(temperature);
  }

  const names = ['constante', 'tendance', ...Array.from({ length: 11 }, (_, index) => `mois_${index + 2}`)];
  const labels = [
    'Constante',
    'Tendance (années)',
    ...Array.from({ length: 11 }, (_, index) => MONTH_LABELS[index + 1]!),
  ];
  return ols('Température moyenne journalière', outcome, design, names, labels);
}

/* ── Séries temporelles ─────────────────────────────────────────────── */

function autocorrelations(values: number[], maximumLag: number): SerialCorrelationPoint[] {
  const n = values.length;
  if (n < 4) return [];
  const mean = meanValue(values);
  if (mean === null) return [];
  let denominator = 0;
  for (const value of values) denominator += (value - mean) ** 2;
  if (denominator === 0) return [];

  const maxLag = Math.min(maximumLag, Math.floor(n / 4));
  const acf: number[] = [];
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let numerator = 0;
    for (let index = lag; index < n; index += 1) {
      numerator += (values[index]! - mean) * (values[index - lag]! - mean);
    }
    acf.push(numerator / denominator);
  }

  // PACF par récursion de Durbin-Levinson.
  const pacf: number[] = [];
  const phi: number[][] = [];
  for (let lag = 1; lag <= maxLag; lag += 1) {
    if (lag === 1) {
      phi[1] = [acf[0]!];
    } else {
      let numerator = acf[lag - 1]!;
      for (let index = 1; index < lag; index += 1) {
        numerator -= phi[lag - 1]![index - 1]! * acf[lag - index - 1]!;
      }
      let denominator = 1;
      for (let index = 1; index < lag; index += 1) {
        denominator -= phi[lag - 1]![index - 1]! * acf[index - 1]!;
      }
      const last = denominator === 0 ? 0 : numerator / denominator;
      const next = [...(phi[lag - 1] ?? [])];
      for (let index = 1; index < lag; index += 1) {
        next[index - 1] = phi[lag - 1]![index - 1]! - last * phi[lag - 1]![lag - index - 1]!;
      }
      next.push(last);
      phi[lag] = next;
    }
    pacf.push(phi[lag]![lag - 1]!);
  }

  return acf.map((value, index) => ({ lag: index + 1, acf: value, pacf: pacf[index] ?? null }));
}

function monthIndexOf(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return year! * 12 + (month! - 1);
}

function addMonths(key: string, count: number): string {
  const index = monthIndexOf(key) + count;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function longestConsecutiveRun<T extends { key: string }>(items: T[]): T[] {
  let best: T[] = [];
  let current: T[] = [];
  for (const item of items) {
    if (current.length === 0 || monthIndexOf(item.key) === monthIndexOf(current[current.length - 1]!.key) + 1) {
      current.push(item);
    } else {
      if (current.length > best.length) best = current;
      current = [item];
    }
  }
  return current.length > best.length ? current : best;
}

function seasonalDecomposition(run: { key: string; temperature: number }[]): SeasonalDecomposition | null {
  const n = run.length;
  if (n < 24) return null;
  const values = run.map((item) => item.temperature);
  const trend: (number | null)[] = Array.from({ length: n }, () => null);

  for (let index = 6; index <= n - 7; index += 1) {
    let total = 0.5 * values[index - 6]! + 0.5 * values[index + 6]!;
    for (let offset = -5; offset <= 5; offset += 1) total += values[index + offset]!;
    trend[index] = total / 12;
  }

  const detrendedByMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (let index = 0; index < n; index += 1) {
    if (trend[index] === null) continue;
    const month = Number(run[index]!.key.slice(5, 7)) - 1;
    detrendedByMonth[month]!.push(values[index]! - trend[index]!);
  }
  const seasonalByMonth = detrendedByMonth.map((valuesOfMonth) => meanValue(valuesOfMonth));
  const known = seasonalByMonth.filter((value): value is number => value !== null);
  const seasonalMean = meanValue(known) ?? 0;
  const normalized = seasonalByMonth.map((value) => (value === null ? null : value - seasonalMean));

  const points: DecompositionPoint[] = run.map((item, index) => {
    const seasonal = normalized[Number(item.key.slice(5, 7)) - 1] ?? null;
    return {
      key: item.key,
      observed: values[index]!,
      trend: trend[index]!,
      seasonal,
      residual:
        trend[index] === null || seasonal === null
          ? null
          : values[index]! - trend[index]! - seasonal,
    };
  });

  return { period: 12, points };
}

interface HoltWintersFit {
  sse: number;
  count: number;
  level: number;
  trend: number;
  season: number[];
  fitted: (number | null)[];
}

function fitHoltWinters(
  values: number[],
  keys: string[],
  alpha: number,
  beta: number,
  gamma: number,
): HoltWintersFit | null {
  const n = values.length;
  if (n < 24) return null;
  const firstYearMean = meanValue(values.slice(0, 12));
  if (firstYearMean === null) return null;
  const season = Array.from({ length: 12 }, () => 0);
  for (let index = 0; index < 12; index += 1) {
    season[Number(keys[index]!.slice(5, 7)) - 1] = values[index]! - firstYearMean;
  }
  const secondYearMean = meanValue(values.slice(12, 24));
  if (secondYearMean === null) return null;
  let level = firstYearMean;
  let trend = (secondYearMean - firstYearMean) / 12;
  let sse = 0;
  let count = 0;
  const fitted: (number | null)[] = Array.from({ length: n }, () => null);

  for (let index = 0; index < n; index += 1) {
    const month = Number(keys[index]!.slice(5, 7)) - 1;
    const forecast = level + trend + season[month]!;
    if (index >= 12) {
      fitted[index] = forecast;
      const error = values[index]! - forecast;
      sse += error ** 2;
      count += 1;
      const newLevel = alpha * (values[index]! - season[month]!) + (1 - alpha) * (level + trend);
      const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
      season[month] = gamma * (values[index]! - newLevel) + (1 - gamma) * season[month]!;
      level = newLevel;
      trend = newTrend;
    }
  }

  return { sse, count, level, trend, season, fitted };
}

function holtWinters(run: { key: string; temperature: number }[]): HoltWintersResult | null {
  const n = run.length;
  if (n < 24) return null;
  const values = run.map((item) => item.temperature);
  const keys = run.map((item) => item.key);
  const grid = [0.1, 0.3, 0.5, 0.7, 0.9];

  let best: HoltWintersFit | null = null;
  let bestParameters = { alpha: 0.3, beta: 0.1, gamma: 0.3 };
  for (const alpha of grid) {
    for (const beta of grid) {
      for (const gamma of grid) {
        const candidate = fitHoltWinters(values, keys, alpha, beta, gamma);
        if (!candidate || candidate.count === 0) continue;
        if (!best || candidate.sse < best.sse) {
          best = candidate;
          bestParameters = { alpha, beta, gamma };
        }
      }
    }
  }
  if (!best || best.count === 0) return null;

  const rmse = Math.sqrt(best.sse / best.count);
  const lastKey = keys[n - 1]!;
  const forecast: AnalysisForecastPoint[] = [];
  for (let horizon = 1; horizon <= 12; horizon += 1) {
    const key = addMonths(lastKey, horizon);
    const month = Number(key.slice(5, 7)) - 1;
    const value = best.level + horizon * best.trend + best.season[month]!;
    forecast.push({
      key,
      value,
      lower: value - 1.96 * rmse,
      upper: value + 1.96 * rmse,
    });
  }

  return {
    alpha: bestParameters.alpha,
    beta: bestParameters.beta,
    gamma: bestParameters.gamma,
    rmse,
    observations: n,
    fitted: run.map((item, index) => ({
      key: item.key,
      observed: item.temperature,
      fitted: best!.fitted[index] ?? null,
    })),
    forecast,
  };
}

function adfTest(run: { key: string; temperature: number }[]): AdfResult {
  const criticalValues = { one: -3.96, five: -3.41, ten: -3.12 };
  const n = run.length;
  if (n < 36) {
    return { n, lags: 0, statistic: null, criticalValues, stationary: null };
  }

  const levels = run.map((item) => item.temperature);
  const differences = levels.slice(1).map((value, index) => value - levels[index]!);
  const lags = Math.min(12, Math.max(1, Math.floor(12 * (n / 100) ** 0.25)));

  const design: Matrix = [];
  const outcome: number[] = [];
  for (let index = lags + 1; index < n; index += 1) {
    const row = [1, index, levels[index - 1]!];
    for (let lag = 1; lag <= lags; lag += 1) {
      row.push(differences[index - lag]!);
    }
    design.push(row);
    outcome.push(differences[index]!);
  }

  const names = ['constante', 'tendance', 'niveau_retarde', ...Array.from({ length: lags }, (_, index) => `diff_${index + 1}`)];
  const result = ols('Différence de température', outcome, design, names, names);
  const coefficient = result?.coefficients.find((item) => item.name === 'niveau_retarde');
  if (!result || !coefficient || coefficient.tStatistic === null) {
    return { n, lags, statistic: null, criticalValues, stationary: null };
  }

  return {
    n,
    lags,
    statistic: coefficient.tStatistic,
    criticalValues,
    stationary: coefficient.tStatistic < criticalValues.five,
  };
}

/* ── Mann-Kendall et tendance de Sen ────────────────────────────────── */

function mannKendall(points: DailyPoint[]): MannKendallResult {
  const byYear = new Map<string, number[]>();
  for (const point of points) {
    if (!isNumber(point.temperatureMean)) continue;
    const year = point.date.slice(0, 4);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(point.temperatureMean);
    else byYear.set(year, [point.temperatureMean]);
  }
  const annual = [...byYear.entries()]
    .map(([year, values]) => ({ year, mean: meanValue(values), count: values.length }))
    .filter((item): item is { year: string; mean: number; count: number } => item.mean !== null && item.count >= 300)
    .sort((a, b) => a.year.localeCompare(b.year));

  const n = annual.length;
  if (n < 3) {
    return { n, s: 0, z: null, pValue: null, slopePerDecade: null, trend: 'stable' };
  }

  let s = 0;
  for (let left = 0; left < n - 1; left += 1) {
    for (let right = left + 1; right < n; right += 1) {
      s += Math.sign(annual[right]!.mean - annual[left]!.mean);
    }
  }
  const variance = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = variance > 0 ? (s - Math.sign(s)) / Math.sqrt(variance) : null;
  const pValue = z === null ? null : Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));

  const slopes: number[] = [];
  for (let left = 0; left < n - 1; left += 1) {
    for (let right = left + 1; right < n; right += 1) {
      slopes.push((annual[right]!.mean - annual[left]!.mean) / (right - left));
    }
  }
  slopes.sort((a, b) => a - b);
  const slope = medianValue(slopes);

  return {
    n,
    s,
    z,
    pValue,
    slopePerDecade: slope === null ? null : slope * 10,
    trend: pValue !== null && pValue < 0.05 ? (s > 0 ? 'hausse' : 'baisse') : 'stable',
  };
}

/* ── Climatologie et extrêmes ───────────────────────────────────────── */

function climatology(points: DailyPoint[]): ClimatologyRow[] {
  const buckets = Array.from({ length: 12 }, () => ({
    temperatureSum: 0,
    temperatureCount: 0,
    precipitationSum: 0,
    precipitationCount: 0,
    wetDays: 0,
  }));

  for (const point of points) {
    const month = Number(point.date.slice(5, 7)) - 1;
    const bucket = buckets[month];
    if (!bucket) continue;
    if (isNumber(point.temperatureMean)) {
      bucket.temperatureSum += point.temperatureMean;
      bucket.temperatureCount += 1;
    }
    if (isNumber(point.precipitationSum)) {
      bucket.precipitationSum += point.precipitationSum;
      bucket.precipitationCount += 1;
      if (point.precipitationSum >= WET_DAY_THRESHOLD_MM) bucket.wetDays += 1;
    }
  }

  return buckets.map((bucket, index) => ({
    month: index + 1,
    label: MONTH_LABELS[index]!,
    temperatureMean: bucket.temperatureCount > 0 ? bucket.temperatureSum / bucket.temperatureCount : null,
    precipitationMean:
      bucket.precipitationCount > 0 ? bucket.precipitationSum / bucket.precipitationCount : null,
    wetDayProbability:
      bucket.precipitationCount > 0 ? bucket.wetDays / bucket.precipitationCount : null,
  }));
}

function extremes(points: { date: string; value: number | null }[]): ExtremesSummary {
  const valid = points
    .filter((point): point is { date: string; value: number } => isNumber(point.value))
    .sort((a, b) => a.value - b.value);
  if (valid.length === 0) return { threshold: null, count: 0, events: [] };
  const threshold = quantile(valid.map((point) => point.value), 0.95);
  if (threshold === null) return { threshold: null, count: 0, events: [] };
  const events: ExtremeEvent[] = valid
    .filter((point) => point.value >= threshold)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  return { threshold, count: valid.filter((point) => point.value >= threshold).length, events };
}

/* ── Machine learning : régression ridge ────────────────────────────── */

const ML_FEATURES = [
  { name: 'lag1', label: 'Température J−1' },
  { name: 'lag2', label: 'Température J−2' },
  { name: 'lag3', label: 'Température J−3' },
  { name: 'lag7', label: 'Température J−7' },
  { name: 'mean7', label: 'Moyenne J−1 à J−7' },
  { name: 'doySin', label: 'Saisonnalité (sinus)' },
  { name: 'doyCos', label: 'Saisonnalité (cosinus)' },
];

interface MlRow {
  date: string;
  target: number;
  features: number[];
}

function buildMlRows(points: DailyPoint[]): MlRow[] {
  const byDate = new Map<string, number | null>();
  for (const point of points) byDate.set(point.date, point.temperatureMean);

  const rows: MlRow[] = [];
  for (const point of points) {
    if (!isNumber(point.temperatureMean)) continue;
    const lags: number[] = [];
    let complete = true;
    for (let lag = 1; lag <= 7; lag += 1) {
      const value = byDate.get(addDays(point.date, -lag));
      if (!isNumber(value)) {
        complete = false;
        break;
      }
      lags.push(value);
    }
    if (!complete) continue;

    const [year, month, day] = point.date.split('-').map(Number);
    const dayOfYear = diffInDays(`${year}-01-01`, point.date);
    const angle = (2 * Math.PI * (dayOfYear + 0.5)) / 365.25;
    rows.push({
      date: point.date,
      target: point.temperatureMean,
      features: [
        lags[0]!,
        lags[1]!,
        lags[2]!,
        lags[6]!,
        lags.reduce((total, value) => total + value, 0) / 7,
        Math.sin(angle),
        Math.cos(angle),
      ],
    });
    void month;
    void day;
  }
  return rows;
}

function mlMetrics(observed: number[], predicted: number[]): MlMetrics {
  if (observed.length === 0 || observed.length !== predicted.length) {
    return { rmse: null, mae: null, r2: null };
  }
  let sse = 0;
  let sae = 0;
  for (let index = 0; index < observed.length; index += 1) {
    const error = observed[index]! - predicted[index]!;
    sse += error ** 2;
    sae += Math.abs(error);
  }
  const meanObserved = meanValue(observed);
  let sst = 0;
  if (meanObserved !== null) {
    for (const value of observed) sst += (value - meanObserved) ** 2;
  }
  return {
    rmse: Math.sqrt(sse / observed.length),
    mae: sae / observed.length,
    r2: sst > 0 ? 1 - sse / sst : null,
  };
}

interface RidgeModel {
  means: number[];
  deviations: number[];
  beta: number[];
}

function fitRidge(rows: MlRow[], lambda: number): RidgeModel | null {
  if (rows.length <= ML_FEATURES.length + 5) return null;
  const width = ML_FEATURES.length;
  const means = Array.from({ length: width }, (_, feature) => {
    let total = 0;
    for (const row of rows) total += row.features[feature]!;
    return total / rows.length;
  });
  const deviations = means.map((mean, feature) => {
    let total = 0;
    for (const row of rows) total += (row.features[feature]! - mean) ** 2;
    const deviation = Math.sqrt(total / rows.length);
    return deviation > 1e-12 ? deviation : 1;
  });

  const design: Matrix = rows.map((row) => [
    1,
    ...row.features.map((value, feature) => (value - means[feature]!) / deviations[feature]!),
  ]);
  const outcome = rows.map((row) => row.target);
  const transposed = transpose(design);
  const xtx = multiplyMatrices(transposed, design);
  for (let index = 1; index <= width; index += 1) xtx[index]![index] = xtx[index]![index]! + lambda;
  const inverse = invertMatrix(xtx);
  if (!inverse) return null;
  return { means, deviations, beta: multiplyMatrixVector(inverse, multiplyMatrixVector(transposed, outcome)) };
}

function predictRidge(model: RidgeModel, row: MlRow): number {
  let value = model.beta[0]!;
  for (let feature = 0; feature < ML_FEATURES.length; feature += 1) {
    value +=
      model.beta[feature + 1]! * ((row.features[feature]! - model.means[feature]!) / model.deviations[feature]!);
  }
  return value;
}

function machineLearning(points: DailyPoint[]): MlResult {
  const empty: MlResult = {
    model: 'Régression ridge',
    target: 'Température moyenne du jour J',
    nTrain: 0,
    nTest: 0,
    lambda: null,
    metrics: { rmse: null, mae: null, r2: null },
    baseline: { rmse: null, mae: null, r2: null },
    predictions: [],
    features: [],
  };

  const rows = buildMlRows(points);
  if (rows.length < 120) return empty;
  const trainCount = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, trainCount);
  const test = rows.slice(trainCount);
  if (train.length < 60 || test.length < 20) return empty;

  const validationCount = Math.max(12, Math.floor(train.length * 0.15));
  const fitCount = train.length - validationCount;
  const candidates = [0.01, 0.1, 1, 10, 100, 1000];
  let bestLambda = 1;
  let bestValidationRmse = Number.POSITIVE_INFINITY;
  for (const lambda of candidates) {
    const model = fitRidge(train.slice(0, fitCount), lambda);
    if (!model) continue;
    const validation = train.slice(fitCount);
    const observed = validation.map((row) => row.target);
    const predicted = validation.map((row) => predictRidge(model, row));
    const rmse = mlMetrics(observed, predicted).rmse;
    if (rmse !== null && rmse < bestValidationRmse) {
      bestValidationRmse = rmse;
      bestLambda = lambda;
    }
  }

  const model = fitRidge(train, bestLambda);
  if (!model) return empty;
  const observed = test.map((row) => row.target);
  const predicted = test.map((row) => predictRidge(model, row));
  const baselinePredicted = test.map((row) => row.features[0]!);

  const stride = Math.max(1, Math.ceil(test.length / 180));
  const predictions = test
    .map((row, index) => ({ date: row.date, observed: row.target, predicted: predicted[index]! }))
    .filter((_, index) => index % stride === 0 || index === test.length - 1);

  const features: MlFeature[] = ML_FEATURES.map((feature, index) => ({
    name: feature.name,
    label: feature.label,
    coefficient: model.beta[index + 1]!,
  })).sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));

  return {
    model: 'Régression ridge',
    target: 'Température moyenne du jour J',
    nTrain: train.length,
    nTest: test.length,
    lambda: bestLambda,
    metrics: mlMetrics(observed, predicted),
    baseline: mlMetrics(observed, baselinePredicted),
    predictions,
    features,
  };
}

/* ── Orchestration ──────────────────────────────────────────────────── */

export function computeAnalysis(
  pointsInput: DailyPoint[],
  units: UnitMap,
  period: { start: string; end: string },
): AnalysisComputation {
  const points = sortAndDedupeDaily(pointsInput);
  const temperatureUnit = units['temperature_2m_mean'] ?? '°C';
  const precipitationUnit = units['precipitation_sum'] ?? 'mm';
  const warnings: string[] = [];

  const monthly = aggregateMonthly(points, period);
  const monthlySeries = monthly.map((row: AggregateRow) => ({
    key: row.key,
    temperature: row.temperatureMean,
    precipitation: row.precipitationIncomplete ? null : row.precipitationTotal,
  }));

  const completeMonths = monthly.filter(
    (row) => row.days >= row.expectedDays && row.temperatureMean !== null,
  );
  const temperatureRun = longestConsecutiveRun(
    completeMonths.map((row) => ({ key: row.key, temperature: row.temperatureMean! })),
  );

  const expectedDays = diffInDays(period.start, period.end) + 1;
  const missingTemperature = points.filter((point) => !isNumber(point.temperatureMean)).length;
  if (points.length < expectedDays) {
    warnings.push(
      `${expectedDays - points.length} jour(s) absent(s) de la réponse ERA5 ; les calculs portent uniquement sur les jours disponibles.`,
    );
  }
  if (missingTemperature > 0) {
    warnings.push(`${missingTemperature} jour(s) sans température moyenne : exclus des calculs, jamais imputés.`);
  }

  const descriptive = {
    temperature: describeSeries('temperature', 'Température moyenne journalière', temperatureUnit, points.map((point) => point.temperatureMean)),
    precipitation: describeSeries('precipitation', 'Précipitations journalières', precipitationUnit, points.map((point) => point.precipitationSum)),
  };

  const olsResult = econometricModel(points);
  if (!olsResult) {
    warnings.push(
      "La régression OLS n'est pas estimée : moins de deux ans de données, moins de 12 mois distincts ou matrice singulière.",
    );
  } else if (olsResult.durbinWatson !== null && olsResult.durbinWatson < 1.5) {
    warnings.push(
      'Durbin-Watson < 1,5 : autocorrélation positive des résidus. Les écarts-types OLS classiques sont probablement sous-estimés.',
    );
  }

  const acf = temperatureRun.length > 0 ? autocorrelations(temperatureRun.map((item) => item.temperature), 24) : [];
  if (temperatureRun.length < 24) {
    warnings.push(
      'Série mensuelle de température trop courte ou discontinue : décomposition, Holt-Winters et ADF ne sont pas calculés.',
    );
  }

  const adf = adfTest(temperatureRun);
  if (adf.stationary === false) {
    warnings.push(
      "ADF ne rejette pas l'hypothèse de racine unitaire : la série de température peut être non stationnaire. Le test a une puissance limitée sur 20 ans.",
    );
  }

  const decomposition = seasonalDecomposition(temperatureRun);
  const holt = holtWinters(temperatureRun);
  const ml = machineLearning(points);
  if (ml.nTest === 0) {
    warnings.push('Le modèle ML nécessite au moins 120 jours complets avec les 7 retards ; il n’a pas pu être entraîné.');
  }

  return {
    period,
    units,
    dailyCount: points.length,
    monthlyCount: monthly.length,
    monthlySeries,
    descriptive,
    correlation: pairwiseCorrelation(points),
    ols: olsResult,
    adf,
    acf,
    decomposition,
    holtWinters: holt,
    ml,
    mannKendall: mannKendall(points),
    climatology: climatology(points),
    extremes: {
      temperatureMax: extremes(points.map((point) => ({ date: point.date, value: point.temperatureMax }))),
      precipitation: extremes(points.map((point) => ({ date: point.date, value: point.precipitationSum }))),
    },
    warnings,
  };
}
