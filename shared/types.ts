/**
 * Contrat d'API de la plateforme Météo Analyse.
 * Ce fichier est la source unique de vérité pour le backend et le frontend :
 * toute évolution de champ doit passer par ici.
 */

export type NullableNumber = number | null;

export interface UnitMap {
  [variable: string]: string;
}

export interface CurrentConditions {
  /** Heure de validité, heure locale du lieu, format ISO sans décalage. */
  time: string;
  /** Durée de validité de la mesure en secondes. */
  intervalSeconds: number;
  temperature: NullableNumber;
  apparentTemperature: NullableNumber;
  humidity: NullableNumber;
  precipitation: NullableNumber;
  weatherCode: NullableNumber;
  windSpeed: NullableNumber;
}

export interface HourlyPoint {
  /** Heure locale du lieu (ISO sans décalage), début de l'intervalle. */
  time: string;
  temperature: NullableNumber;
  humidity: NullableNumber;
  precipitationProbability: NullableNumber;
  precipitation: NullableNumber;
  windSpeed: NullableNumber;
}

export interface DailyPoint {
  /** Date locale du lieu, YYYY-MM-DD. */
  date: string;
  temperatureMean: NullableNumber;
  temperatureMax: NullableNumber;
  temperatureMin: NullableNumber;
  precipitationSum: NullableNumber;
}

export interface SourceInfo {
  name: string;
  url: string;
  licence: string;
  attribution: string;
}

export interface ForecastPayload {
  kind: 'forecast';
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  units: {
    current: UnitMap;
    hourly: UnitMap;
    daily: UnitMap;
  };
  current: CurrentConditions | null;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  /** Heure de récupération côté serveur, en UTC. Distinct de la validité. */
  fetchedAt: string;
  source: SourceInfo;
}

export type HistoryPeriodState = 'ok' | 'empty' | 'error';

export interface HistoryPeriod {
  start: string;
  end: string;
  status: HistoryPeriodState;
  message?: string;
}

export interface HistoryPayload {
  kind: 'history';
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  units: UnitMap;
  model: 'era5';
  daily: DailyPoint[];
  expectedDays: number;
  availableDays: number;
  /** Dates absentes ou dont toutes les variables sont nulles. */
  missingDays: string[];
  /** Dates apparues dans plusieurs fragments d'archive (doublons fusionnés). */
  duplicateDays: string[];
  periods: HistoryPeriod[];
  fetchedAt: string;
  source: SourceInfo;
}

export interface ApiErrorBody {
  error: string;
  reason?: string;
}

/* ── Analyses statistiques, économétriques et modèles ───────────────── */

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export interface DescriptiveStats {
  variable: 'temperature' | 'precipitation';
  label: string;
  unit: string;
  count: number;
  missing: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  minimum: number | null;
  maximum: number | null;
  quartile1: number | null;
  quartile3: number | null;
  skewness: number | null;
  kurtosis: number | null;
  meanCi95: ConfidenceInterval | null;
  coefficientOfVariation: number | null;
}

export interface OlsCoefficient {
  name: string;
  label: string;
  estimate: number;
  stdError: number | null;
  tStatistic: number | null;
  pValue: number | null;
  ci95: ConfidenceInterval | null;
}

export interface OlsResult {
  /** Variable expliquée. */
  target: string;
  n: number;
  parameters: number;
  r2: number;
  adjustedR2: number;
  fStatistic: number | null;
  fPValue: number | null;
  residualStandardError: number | null;
  durbinWatson: number | null;
  coefficients: OlsCoefficient[];
}

export interface SerialCorrelationPoint {
  lag: number;
  acf: number | null;
  pacf: number | null;
}

export interface AdfResult {
  n: number;
  lags: number;
  statistic: number | null;
  criticalValues: { one: number; five: number; ten: number };
  stationary: boolean | null;
}

export interface DecompositionPoint {
  key: string;
  observed: number | null;
  trend: number | null;
  seasonal: number | null;
  residual: number | null;
}

export interface SeasonalDecomposition {
  period: number;
  points: DecompositionPoint[];
}

export interface AnalysisForecastPoint {
  key: string;
  value: number;
  lower: number;
  upper: number;
}

export interface HoltWintersResult {
  alpha: number;
  beta: number;
  gamma: number;
  rmse: number | null;
  observations: number;
  fitted: { key: string; observed: number; fitted: number | null }[];
  forecast: AnalysisForecastPoint[];
}

export interface MlMetrics {
  rmse: number | null;
  mae: number | null;
  r2: number | null;
}

export interface MlFeature {
  name: string;
  label: string;
  coefficient: number;
}

export interface MlPrediction {
  date: string;
  observed: number;
  predicted: number;
}

export interface MlResult {
  model: string;
  target: string;
  nTrain: number;
  nTest: number;
  lambda: number | null;
  metrics: MlMetrics;
  baseline: MlMetrics;
  predictions: MlPrediction[];
  features: MlFeature[];
}

export interface MannKendallResult {
  n: number;
  s: number;
  z: number | null;
  pValue: number | null;
  slopePerDecade: number | null;
  trend: 'hausse' | 'baisse' | 'stable';
}

export interface ExtremeEvent {
  date: string;
  value: number;
}

export interface ExtremesSummary {
  threshold: number | null;
  count: number;
  events: ExtremeEvent[];
}

export interface ClimatologyRow {
  month: number;
  label: string;
  temperatureMean: number | null;
  precipitationMean: number | null;
  wetDayProbability: number | null;
}

export interface AnalysisPayload {
  kind: 'analysis';
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  units: UnitMap;
  model: 'era5';
  period: { start: string; end: string };
  dailyCount: number;
  monthlyCount: number;
  monthlySeries: { key: string; temperature: number | null; precipitation: number | null }[];
  descriptive: { temperature: DescriptiveStats; precipitation: DescriptiveStats };
  correlation: { pearson: number | null; spearman: number | null; n: number };
  ols: OlsResult | null;
  adf: AdfResult;
  acf: SerialCorrelationPoint[];
  decomposition: SeasonalDecomposition | null;
  holtWinters: HoltWintersResult | null;
  ml: MlResult;
  mannKendall: MannKendallResult;
  climatology: ClimatologyRow[];
  extremes: { temperatureMax: ExtremesSummary; precipitation: ExtremesSummary };
  warnings: string[];
  fetchedAt: string;
  source: SourceInfo;
}

/** Résultat pur de `computeAnalysis` (sans métadonnées de requête / provenance). */
export type AnalysisComputation = Omit<
  AnalysisPayload,
  | 'kind'
  | 'latitude'
  | 'longitude'
  | 'timezone'
  | 'timezoneAbbreviation'
  | 'utcOffsetSeconds'
  | 'model'
  | 'fetchedAt'
  | 'source'
>;

export type ApiPayload = ForecastPayload | HistoryPayload | AnalysisPayload;
