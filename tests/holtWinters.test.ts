import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../shared/analysis.js';
import type { DailyPoint, UnitMap } from '../shared/types.js';

/**
 * Garde-fou sur l'optimisation de Holt-Winters.
 *
 * Le réglage des paramètres (alpha, beta, gamma) a été déplacé d'une grille 5³ à
 * un Nelder-Mead avec arrêt sur stagnation. Ce test fige la qualité atteinte :
 * un retour à la grille grossière, ou un arrêt sur stagnation trop précoce,
 * dégrade le RMSE d'ajustement au-delà du seuil et échoue ici.
 *
 * Valeurs mesurées sur ce jeu (10 ans, graines 7 / 42 / 1234) :
 *   grille 5³    RMSE = 0,1631 / 0,1642 / 0,1390
 *   Nelder-Mead  RMSE = 0,1583 / 0,1606 / 0,1335  (soit −3 à −4 %)
 * Le RMSE d'ajustement est le critère discriminant ; l'erreur de prévision à
 * 12 mois, elle, varie d'une série à l'autre et n'est pas garantie meilleure.
 */

const UNITS: UnitMap = {
  temperature_2m_mean: '°C',
  temperature_2m_max: '°C',
  temperature_2m_min: '°C',
  precipitation_sum: 'mm',
};

/** Générateur congruentiel : séries reproductibles, aucune dépendance. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeNormal(random: () => number): () => number {
  return () => {
    const u = Math.max(random(), 1e-12);
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Moyenne mensuelle « vraie » du modèle : base + tendance + saisonnalité. */
function trueMonthlyMean(year: number, month: number): number {
  const years = year + (month - 0.5) / 12 - 2000;
  return 21 + 0.03 * years + 4 * Math.sin((2 * Math.PI * (month - 4)) / 12);
}

function generateSeries(years: number, seed: number) {
  const normal = makeNormal(makeRandom(seed));
  const points: DailyPoint[] = [];
  const monthlyMeans = new Map<string, number>();
  for (let year = 2000; year < 2000 + years; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const days = daysInMonth(year, month);
      let sum = 0;
      for (let day = 1; day <= days; day += 1) {
        const value = trueMonthlyMean(year, month) + 0.7 * normal();
        sum += value;
        points.push({
          date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          temperatureMean: value,
          temperatureMax: value + 4,
          temperatureMin: value - 4,
          precipitationSum: Math.max(0, 2 * normal()),
        });
      }
      monthlyMeans.set(`${year}-${String(month).padStart(2, '0')}`, sum / days);
    }
  }
  return { points, monthlyMeans };
}

describe('Holt-Winters : qualité de l’ajustement', () => {
  const train = generateSeries(10, 42);
  const full = generateSeries(11, 42);
  const period = { start: train.points[0]!.date, end: train.points.at(-1)!.date };

  it('ajuste la série mensuelle mieux que la grille grossière 5³', () => {
    const analysis = computeAnalysis(train.points, UNITS, period);
    const holt = analysis.holtWinters;

    expect(holt).not.toBeNull();
    expect(holt!.observations).toBe(120);
    // Seuil placé entre Nelder-Mead (0,1606) et la grille 5³ (0,1642).
    expect(holt!.rmse).toBeLessThan(0.1625);
  });

  it('prévoit 12 mois consécutifs avec une erreur bornée', () => {
    const holt = computeAnalysis(train.points, UNITS, period).holtWinters!;

    expect(holt.forecast).toHaveLength(12);
    expect(holt.forecast[0]!.key).toBe('2010-01');
    expect(holt.forecast.at(-1)!.key).toBe('2010-12');
    for (const point of holt.forecast) {
      expect(point.lower).toBeLessThan(point.value);
      expect(point.upper).toBeGreaterThan(point.value);
    }

    const errors = holt.forecast.map((point) =>
      Math.abs((full.monthlyMeans.get(point.key) ?? 0) - point.value),
    );
    const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    // Mesuré 0,105 °C sur la dernière année tenue à l'écart.
    expect(mae).toBeLessThan(0.12);
  });

  it('reste déterministe et n’extrapole pas hors de [0, 1]', () => {
    const first = computeAnalysis(train.points, UNITS, period).holtWinters!;
    const second = computeAnalysis(train.points, UNITS, period).holtWinters!;

    expect(second.alpha).toBe(first.alpha);
    expect(second.beta).toBe(first.beta);
    expect(second.gamma).toBe(first.gamma);
    for (const parameter of [first.alpha, first.beta, first.gamma]) {
      expect(parameter).toBeGreaterThanOrEqual(0);
      expect(parameter).toBeLessThanOrEqual(1);
    }
  });
});
