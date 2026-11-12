/**
 * Données simulées réservées aux tests navigateur.
 * Jamais utilisées par l'application elle-même.
 */
import type { AnalysisPayload, DailyPoint, ForecastPayload, HistoryPayload } from '../../shared/types.js';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hourlyTimes(count: number): string[] {
  const base = Date.UTC(2026, 10, 10, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(base + index * 3_600_000);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:00`;
  });
}

function daysFrom(startDate: string, count: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export const mockForecast: ForecastPayload = {
  kind: 'forecast',
  latitude: -18.8792,
  longitude: 47.5079,
  timezone: 'Indian/Antananarivo',
  timezoneAbbreviation: 'EAT',
  utcOffsetSeconds: 10800,
  units: {
    current: {
      temperature_2m: '°C',
      apparent_temperature: '°C',
      relative_humidity_2m: '%',
      precipitation: 'mm',
      wind_speed_10m: 'km/h',
    },
    hourly: {
      temperature_2m: '°C',
      relative_humidity_2m: '%',
      precipitation_probability: '%',
      precipitation: 'mm',
      wind_speed_10m: 'km/h',
    },
    daily: {
      temperature_2m_mean: '°C',
      temperature_2m_max: '°C',
      temperature_2m_min: '°C',
      precipitation_sum: 'mm',
    },
  },
  current: {
    time: '2026-11-10T12:00',
    intervalSeconds: 900,
    temperature: 24.5,
    apparentTemperature: 25.2,
    humidity: 72,
    precipitation: 0,
    weatherCode: 1,
    windSpeed: 12.3,
  },
  hourly: hourlyTimes(72).map((time, index) => ({
    time,
    temperature: 20 + (index % 12) * 0.4,
    humidity: 60 + (index % 20),
    precipitationProbability: index % 24 === 15 ? 60 : 10,
    precipitation: index % 24 === 15 ? 1.2 : 0,
    windSpeed: 8 + (index % 6),
  })),
  daily: daysFrom('2026-11-10', 7).map((date, index) => ({
    date,
    temperatureMean: 23 + index * 0.2,
    temperatureMax: 28 + index * 0.3,
    temperatureMin: 18 - index * 0.1,
    precipitationSum: index === 2 ? 4.5 : 0,
  })),
  fetchedAt: '2026-11-10T09:00:00.000Z',
  source: {
    name: 'Open-Meteo — prévisions météorologiques',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0',
    attribution: 'Données : Open-Meteo.com — réutilisation sous licence CC BY 4.0, attribution obligatoire.',
  },
};

export const mockHistoryDaily: DailyPoint[] = daysFrom('2000-01-01', 10).map((date, index) =>
  index === 4
    ? {
        date,
        temperatureMean: null,
        temperatureMax: null,
        temperatureMin: null,
        precipitationSum: null,
      }
    : {
        date,
        temperatureMean: 22 + index * 0.5,
        temperatureMax: 28 + index * 0.5,
        temperatureMin: 17 + index * 0.5,
        precipitationSum: index === 2 ? 6.2 : 0,
      },
);

export const mockHistory: HistoryPayload = {
  kind: 'history',
  latitude: -18.8792,
  longitude: 47.5079,
  timezone: 'Indian/Antananarivo',
  timezoneAbbreviation: 'EAT',
  utcOffsetSeconds: 10800,
  units: {
    temperature_2m_mean: '°C',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_sum: 'mm',
  },
  model: 'era5',
  daily: mockHistoryDaily,
  expectedDays: 10,
  availableDays: 9,
  missingDays: [mockHistoryDaily[4]!.date],
  duplicateDays: [],
  periods: [{ start: '2000-01-01', end: '2000-12-31', status: 'ok' }],
  fetchedAt: '2026-11-10T09:00:00.000Z',
  source: {
    name: 'Open-Meteo — réanalyse ERA5 (archive)',
    url: 'https://open-meteo.com/en/docs/historical-weather-api',
    licence: 'CC BY 4.0',
    attribution: 'Données : Open-Meteo.com — réutilisation sous licence CC BY 4.0, attribution obligatoire.',
  },
};

const emptyMetrics = { rmse: null, mae: null, r2: null };

export const mockAnalysis: AnalysisPayload = {
  kind: 'analysis',
  latitude: -18.8792,
  longitude: 47.5079,
  timezone: 'Indian/Antananarivo',
  timezoneAbbreviation: 'EAT',
  utcOffsetSeconds: 10800,
  units: {
    temperature_2m_mean: '°C',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_sum: 'mm',
  },
  model: 'era5',
  period: { start: '2021-01-01', end: '2025-12-31' },
  dailyCount: 1826,
  monthlyCount: 60,
  monthlySeries: [
    { key: '2021-01', temperature: 22.5, precipitation: 120 },
    { key: '2021-02', temperature: 22.8, precipitation: 140 },
    { key: '2021-03', temperature: 21.9, precipitation: 90 },
  ],
  descriptive: {
    temperature: {
      variable: 'temperature',
      label: 'Température moyenne journalière',
      unit: '°C',
      count: 1800,
      missing: 26,
      mean: 19.4,
      median: 19.2,
      standardDeviation: 2.1,
      minimum: 12.0,
      maximum: 27.5,
      quartile1: 17.8,
      quartile3: 21.0,
      skewness: 0.1,
      kurtosis: 2.8,
      meanCi95: { lower: 19.3, upper: 19.5 },
      coefficientOfVariation: 0.11,
    },
    precipitation: {
      variable: 'precipitation',
      label: 'Précipitations journalières',
      unit: 'mm',
      count: 1800,
      missing: 26,
      mean: 3.2,
      median: 0.0,
      standardDeviation: 8.5,
      minimum: 0.0,
      maximum: 85.0,
      quartile1: 0.0,
      quartile3: 2.0,
      skewness: 3.5,
      kurtosis: 18.0,
      meanCi95: { lower: 2.8, upper: 3.6 },
      coefficientOfVariation: 2.7,
    },
  },
  correlation: { pearson: -0.12, spearman: -0.08, n: 1800 },
  ols: {
    target: 'Température moyenne journalière',
    n: 1800,
    parameters: 13,
    r2: 0.42,
    adjustedR2: 0.41,
    fStatistic: 95.2,
    fPValue: 1e-8,
    residualStandardError: 1.6,
    durbinWatson: 1.1,
    coefficients: [
      {
        name: 'constante',
        label: 'Constante',
        estimate: 19.0,
        stdError: 0.2,
        tStatistic: 95,
        pValue: 0,
        ci95: { lower: 18.6, upper: 19.4 },
      },
      {
        name: 'tendance',
        label: 'Tendance (années)',
        estimate: 0.02,
        stdError: 0.01,
        tStatistic: 2.0,
        pValue: 0.045,
        ci95: { lower: 0.001, upper: 0.039 },
      },
    ],
  },
  adf: {
    n: 48,
    lags: 2,
    statistic: -3.2,
    criticalValues: { one: -3.5, five: -2.9, ten: -2.6 },
    stationary: true,
  },
  acf: [
    { lag: 1, acf: 0.7, pacf: 0.7 },
    { lag: 2, acf: 0.4, pacf: -0.1 },
  ],
  decomposition: {
    period: 12,
    points: [
      { key: '2021-01', observed: 22.5, trend: 22.0, seasonal: 0.5, residual: 0.0 },
      { key: '2021-02', observed: 22.8, trend: 22.1, seasonal: 0.6, residual: 0.1 },
    ],
  },
  holtWinters: {
    alpha: 0.3,
    beta: 0.1,
    gamma: 0.2,
    rmse: 0.8,
    observations: 48,
    fitted: [
      { key: '2021-01', observed: 22.5, fitted: 22.4 },
      { key: '2021-02', observed: 22.8, fitted: 22.6 },
    ],
    forecast: [
      { key: '2026-01', value: 22.7, lower: 21.5, upper: 23.9 },
      { key: '2026-02', value: 22.9, lower: 21.6, upper: 24.2 },
    ],
  },
  ml: {
    model: 'Régression ridge',
    target: 'Température moyenne du jour J',
    nTrain: 1400,
    nTest: 300,
    lambda: 1.0,
    metrics: { rmse: 1.2, mae: 0.9, r2: 0.55 },
    baseline: emptyMetrics,
    predictions: [
      { date: '2025-01-01', observed: 22.0, predicted: 21.8 },
      { date: '2025-01-02', observed: 22.2, predicted: 22.0 },
    ],
    features: [
      { name: 'lag1', label: 'Retard J-1', coefficient: 0.45 },
      { name: 'month', label: 'Mois', coefficient: -0.02 },
    ],
  },
  mannKendall: {
    n: 1800,
    s: 120,
    z: 2.1,
    pValue: 0.036,
    slopePerDecade: 0.18,
    trend: 'hausse',
  },
  climatology: [
    { month: 1, label: 'Janvier', temperatureMean: 22.5, precipitationMean: 280, wetDayProbability: 0.55 },
    { month: 2, label: 'Février', temperatureMean: 22.8, precipitationMean: 250, wetDayProbability: 0.52 },
  ],
  extremes: {
    temperatureMax: {
      threshold: 30,
      count: 2,
      events: [
        { date: '2023-11-15', value: 31.2 },
        { date: '2024-10-02', value: 30.8 },
      ],
    },
    precipitation: {
      threshold: 60,
      count: 1,
      events: [{ date: '2022-01-20', value: 78.5 }],
    },
  },
  warnings: ['Jeu de données de démonstration réservé aux tests navigateur.'],
  fetchedAt: '2026-11-10T09:00:00.000Z',
  source: {
    name: 'Open-Meteo — réanalyse ERA5 (archive)',
    url: 'https://open-meteo.com/en/docs/historical-weather-api',
    licence: 'CC BY 4.0',
    attribution: 'Données : Open-Meteo.com — réutilisation sous licence CC BY 4.0, attribution obligatoire.',
  },
};
