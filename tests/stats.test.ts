import { describe, expect, it } from 'vitest';
import type { DailyPoint } from '../shared/types.js';
import {
  aggregateAnnual,
  aggregateMonthly,
  computePeriodStatistics,
  findMissingDays,
  isPointEmpty,
  movingAverage7,
  precipitationSeries,
  sortAndDedupeDaily,
  WET_DAY_THRESHOLD_MM,
} from '../shared/stats.js';

function day(date: string, tm: number | null, tmax: number | null, tmin: number | null, precip: number | null): DailyPoint {
  return { date, temperatureMean: tm, temperatureMax: tmax, temperatureMin: tmin, precipitationSum: precip };
}

describe('isPointEmpty', () => {
  it("retourne true si toutes les valeurs sont null", () => {
    expect(isPointEmpty(day('2000-01-01', null, null, null, null))).toBe(true);
  });
  it("retourne false si au moins une valeur est presente", () => {
    expect(isPointEmpty(day('2000-01-01', 20, null, null, null))).toBe(false);
    expect(isPointEmpty(day('2000-01-01', null, null, null, 0))).toBe(false);
  });
});

describe('sortAndDedupeDaily', () => {
  it("trie les points par date", () => {
    const pts = [day('2000-01-03', 1, 2, 0, 0), day('2000-01-01', 2, 3, 1, 1), day('2000-01-02', 3, 4, 2, 2)];
    const sorted = sortAndDedupeDaily(pts);
    expect(sorted.map((p) => p.date)).toEqual(['2000-01-01', '2000-01-02', '2000-01-03']);
  });
  it("deduplique : garde la derniere valeur vue", () => {
    const pts = [
      day('2000-01-01', 20, 25, 15, 5),
      day('2000-01-01', 21, 26, 16, 6),
    ];
    const sorted = sortAndDedupeDaily(pts);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]?.temperatureMean).toBe(21);
  });
});

describe('findMissingDays', () => {
  it("detecte les dates manquantes", () => {
    const pts = [day('2000-01-01', 20, 25, 15, 1), day('2000-01-03', 21, 26, 16, 2)];
    expect(findMissingDays(pts, '2000-01-01', '2000-01-03')).toEqual(['2000-01-02']);
  });
  it("retourne vide si tout est present", () => {
    const pts = ['2000-01-01', '2000-01-02', '2000-01-03'].map((d) => day(d, 20, 25, 15, 1));
    expect(findMissingDays(pts, '2000-01-01', '2000-01-03')).toEqual([]);
  });
  it("exclut les jours entierement vides", () => {
    const pts = [
      day('2000-01-01', 20, 25, 15, 1),
      day('2000-01-02', null, null, null, null), // vide -> considere manquant
      day('2000-01-03', 21, 26, 16, 2),
    ];
    expect(findMissingDays(pts, '2000-01-01', '2000-01-03')).toEqual(['2000-01-02']);
  });
});

describe('computePeriodStatistics', () => {
  const pts = [
    day('2000-01-01', 20, 28, 14, 5),
    day('2000-01-02', 22, 30, 16, 0),
    day('2000-01-03', null, 31, 15, null),
  ];

  it("calcule la moyenne sur les jours disponibles", () => {
    const stats = computePeriodStatistics(pts);
    // 20 + 22 = 42 / 2 = 21
    expect(stats.meanTemperature).toBeCloseTo(21, 5);
    expect(stats.availableTemperatureDays).toBe(2);
  });

  it("calcule le maximum des maxima", () => {
    expect(computePeriodStatistics(pts).maxTemperature).toBe(31);
  });

  it("calcule le minimum des minima", () => {
    expect(computePeriodStatistics(pts).minTemperature).toBe(14);
  });

  it("cumule les precipitations disponibles", () => {
    const stats = computePeriodStatistics(pts);
    expect(stats.precipitationTotal).toBeCloseTo(5, 5);
    expect(stats.precipitationIncomplete).toBe(true);
  });

  it("compte les jours pluvieux", () => {
    const stats = computePeriodStatistics(pts);
    // jour 1 : 5 >= 1 OK, jour 2 : 0 non, jour 3 : null ignore
    expect(stats.wetDays).toBe(1);
    expect(stats.wetDaysIncomplete).toBe(true);
  });

  it("retourne null sur donnees vides", () => {
    const stats = computePeriodStatistics([]);
    expect(stats.meanTemperature).toBeNull();
    expect(stats.precipitationTotal).toBeNull();
    expect(stats.wetDays).toBeNull();
  });

  it("ne remplace jamais null par 0", () => {
    const stats = computePeriodStatistics([day('2000-01-01', null, null, null, null)]);
    expect(stats.meanTemperature).toBeNull();
    expect(stats.precipitationTotal).toBeNull();
  });
});

describe('movingAverage7', () => {
  it("retourne null pour les 6 premiers points", () => {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(0, 10);
      return day(d, 20, 25, 15, 1);
    });
    const ma = movingAverage7(pts);
    for (let i = 0; i < 6; i++) expect(ma[i]).toBeNull();
    expect(ma[6]).not.toBeNull();
  });

  it("calcule la moyenne correcte sur 7 jours consecutifs", () => {
    // temperatures 1 a 7 -> moyenne = 4
    const pts = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(0, 10);
      return day(d, i + 1, i + 5, i, 1);
    });
    const ma = movingAverage7(pts);
    expect(ma[6]).toBeCloseTo(4, 5);
  });

  it("retourne null si un jour manque dans la fenetre", () => {
    // Saute le 4 janvier : jours 1,2,3,5,6,7,8
    const dates = [1, 2, 3, 5, 6, 7, 8].map((d) => new Date(Date.UTC(2000, 0, d)).toISOString().slice(0, 10));
    const pts = dates.map((d) => day(d, 20, 25, 15, 1));
    const ma = movingAverage7(pts);
    expect(ma[6]).toBeNull(); // fenetre [1,2,3,5,6,7,8] pas consecutive
  });

  it("retourne null si une valeur est null dans la fenetre", () => {
    const pts = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(0, 10);
      return day(d, i === 3 ? null : 20, 25, 15, 1); // jour 4 null
    });
    const ma = movingAverage7(pts);
    expect(ma[6]).toBeNull();
  });

  it("gere les annees bissextiles", () => {
    // Fenetre qui traverse le 29 fevrier 2000
    // 7 jours consecutifs valides : 25-29 fevrier + 1-2 mars
    const dates = [
      '2000-02-25', '2000-02-26', '2000-02-27', '2000-02-28',
      '2000-02-29', '2000-03-01', '2000-03-02',
    ];
    const pts = dates.map((d) => day(d, 20, 25, 15, 1));
    const ma = movingAverage7(pts);
    expect(ma[6]).not.toBeNull(); // fenetre consecutive valide
  });
});

describe('aggregateMonthly', () => {
  const pts = [
    day('2000-01-01', 20, 28, 14, 5),
    day('2000-01-15', 22, 30, 16, 3),
    day('2000-02-10', 18, 25, 12, 10),
  ];

  it("groupe par mois", () => {
    const rows = aggregateMonthly(pts);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.key).toBe('2000-01');
    expect(rows[1]?.key).toBe('2000-02');
  });

  it("calcule la moyenne du mois correctement", () => {
    const rows = aggregateMonthly(pts);
    expect(rows[0]?.temperatureMean).toBeCloseTo(21, 5);
    expect(rows[1]?.temperatureMean).toBeCloseTo(18, 5);
  });

  it("marque le cumul incomplet si des jours manquent", () => {
    const rows = aggregateMonthly(pts);
    // janvier n'a que 2 jours sur 31
    expect(rows[0]?.precipitationIncomplete).toBe(true);
  });
});

describe('aggregateAnnual', () => {
  it("groupe par annee", () => {
    const pts = [
      day('2000-06-01', 25, 30, 20, 5),
      day('2001-03-15', 22, 28, 18, 3),
    ];
    const rows = aggregateAnnual(pts);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.key).toBe('2000');
    expect(rows[1]?.key).toBe('2001');
  });
});

describe('precipitationSeries', () => {
  it("retourne un tableau aligne", () => {
    const pts = [day('2000-01-01', 20, 25, 15, 5), day('2000-01-02', 21, 26, 16, null)];
    const series = precipitationSeries(pts);
    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({ date: '2000-01-01', value: 5 });
    expect(series[1]).toEqual({ date: '2000-01-02', value: null });
  });
});

describe('WET_DAY_THRESHOLD_MM', () => {
  it("est egal a 1", () => {
    expect(WET_DAY_THRESHOLD_MM).toBe(1);
  });
});
