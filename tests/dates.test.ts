import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInMonth,
  diffInDays,
  enumerateDates,
  formatFRDate,
  formatFRHour,
  formatFRMonth,
  formatFRWeekday,
  fromUTC,
  isValidISODate,
  monthKeyOf,
  parseISODate,
  subtractDays,
  todayUTC,
} from '../shared/dates.js';

describe('isValidISODate', () => {
  it("valide une date reelle", () => {
    expect(isValidISODate('2000-01-31')).toBe(true);
    expect(isValidISODate('2000-02-29')).toBe(true); // bissextile
  });
  it("rejette une date invalide", () => {
    expect(isValidISODate('2001-02-29')).toBe(false); // non bissextile
    expect(isValidISODate('2000-13-01')).toBe(false);
    expect(isValidISODate('2000-00-01')).toBe(false);
    expect(isValidISODate('not-a-date')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('parseISODate', () => {
  it("decompose correctement", () => {
    expect(parseISODate('2024-11-07')).toEqual({ year: 2024, month: 11, day: 7 });
  });
  it("leve une erreur sur date invalide", () => {
    expect(() => parseISODate('2001-02-29')).toThrow();
  });
});

describe('daysInMonth', () => {
  it("retourne 29 pour fevrier 2000 bissextile", () => {
    expect(daysInMonth(2000, 2)).toBe(29);
  });
  it("retourne 28 pour fevrier 2001", () => {
    expect(daysInMonth(2001, 2)).toBe(28);
  });
  it("retourne 31 pour janvier", () => {
    expect(daysInMonth(2000, 1)).toBe(31);
  });
  it("retourne 30 pour avril", () => {
    expect(daysInMonth(2000, 4)).toBe(30);
  });
});

describe('addDays / subtractDays', () => {
  it("addDays fonctionne sur un passage de mois", () => {
    expect(addDays('2000-01-30', 3)).toBe('2000-02-02');
  });
  it("subtractDays inverse addDays", () => {
    expect(subtractDays(addDays('2000-06-15', 10), 10)).toBe('2000-06-15');
  });
  it("gere le passage d'annee bissextile", () => {
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    expect(addDays('2000-02-29', 1)).toBe('2000-03-01');
  });
});

describe('diffInDays', () => {
  it("retourne 0 pour dates identiques", () => {
    expect(diffInDays('2000-01-01', '2000-01-01')).toBe(0);
  });
  it("retourne le bon nombre de jours", () => {
    expect(diffInDays('2000-01-01', '2000-01-31')).toBe(30);
  });
  it("retourne negatif si end < start", () => {
    expect(diffInDays('2000-01-31', '2000-01-01')).toBe(-30);
  });
});

describe('enumerateDates', () => {
  it("retourne les dates incluses", () => {
    expect(enumerateDates('2000-01-01', '2000-01-03')).toEqual([
      '2000-01-01',
      '2000-01-02',
      '2000-01-03',
    ]);
  });
  it("retourne vide si end < start", () => {
    expect(enumerateDates('2000-01-05', '2000-01-01')).toEqual([]);
  });
  it("inclut le 29 fevrier sur une annee bissextile", () => {
    const dates = enumerateDates('2000-02-27', '2000-03-02');
    expect(dates).toContain('2000-02-29');
    expect(dates).toHaveLength(5);
  });
});

describe('fromUTC', () => {
  it("convertit un timestamp en date ISO", () => {
    expect(fromUTC(Date.UTC(2000, 0, 15))).toBe('2000-01-15');
  });
});

describe('todayUTC', () => {
  it("retourne une date au format YYYY-MM-DD", () => {
    expect(isValidISODate(todayUTC())).toBe(true);
  });
});

describe('monthKeyOf', () => {
  it("extrait le mois", () => {
    expect(monthKeyOf('2000-11-15')).toBe('2000-11');
  });
});

describe('formatFRDate', () => {
  it("formate en JJ/MM/AAAA", () => {
    expect(formatFRDate('2000-01-05')).toBe('05/01/2000');
  });
  it("retourne la valeur telle quelle si invalide", () => {
    expect(formatFRDate('invalid')).toBe('invalid');
  });
});

describe('formatFRHour', () => {
  it("formate heure locale", () => {
    const result = formatFRHour('2026-11-10T13:00');
    expect(result).toContain('13 h');
  });
  it("fonctionne sans heure", () => {
    const result = formatFRHour('2026-11-10');
    expect(result).toContain('10/11');
  });
});

describe('formatFRMonth', () => {
  it("retourne le mois en francais", () => {
    const result = formatFRMonth('2000-01');
    expect(result).toMatch(/janv/i);
  });
  it("retourne la cle brute si invalide", () => {
    expect(formatFRMonth('invalid')).toBe('invalid');
  });
});

describe('formatFRWeekday', () => {
  it("retourne le jour de la semaine en francais", () => {
    // 2000-01-01 etait un samedi
    const result = formatFRWeekday('2000-01-01');
    expect(result).toMatch(/sam/i);
  });
});
