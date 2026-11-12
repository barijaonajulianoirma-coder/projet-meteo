import { describe, expect, it } from 'vitest';
import { computeAnalysis } from '../shared/analysis.js';
import { addDays } from '../shared/dates.js';
import type { DailyPoint } from '../shared/types.js';

function buildSeries(start: string, days: number): DailyPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const month = Number(date.slice(5, 7));
    const seasonal = Math.sin(((month - 1) / 12) * Math.PI * 2) * 2;
    return {
      date,
      temperatureMean: 20 + seasonal + (index % 17) * 0.01,
      temperatureMax: 26 + seasonal,
      temperatureMin: 15 + seasonal,
      precipitationSum: month <= 3 ? 8 + (index % 5) : index % 11 === 0 ? 12 : 0,
    };
  });
}

describe('computeAnalysis', () => {
  it('produit les blocs statistiques, séries temporelles et ML sur une série longue', () => {
    const points = buildSeries('2018-01-01', 365 * 4 + 1);
    const result = computeAnalysis(
      points,
      {
        temperature_2m_mean: '°C',
        precipitation_sum: 'mm',
      },
      { start: '2018-01-01', end: addDays('2018-01-01', points.length - 1) },
    );

    expect(result.dailyCount).toBe(points.length);
    expect(result.descriptive.temperature.count).toBeGreaterThan(1000);
    expect(result.correlation.n).toBeGreaterThan(1000);
    expect(result.ols).not.toBeNull();
    expect(result.ols?.coefficients.length).toBeGreaterThan(1);
    expect(result.adf.n).toBeGreaterThan(0);
    expect(result.ml.nTrain).toBeGreaterThan(0);
    expect(result.mannKendall.trend).toMatch(/hausse|baisse|stable/);
    expect(result.climatology).toHaveLength(12);
    expect(result.period.start).toBe('2018-01-01');
  });

  it('reste défini sur une période courte (avertissements, modèles optionnels absents)', () => {
    const points = buildSeries('2024-01-01', 60);
    const result = computeAnalysis(points, { temperature_2m_mean: '°C' }, {
      start: '2024-01-01',
      end: '2024-03-01',
    });

    expect(result.descriptive.temperature.count).toBeGreaterThan(0);
    expect(result.ols).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
