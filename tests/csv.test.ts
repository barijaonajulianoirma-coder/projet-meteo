import { describe, expect, it } from 'vitest';
import { csvCell, guardFormula, toCsv } from '../shared/csv.js';

describe('guardFormula', () => {
  it("ne touche pas aux nombres negatifs", () => {
    expect(guardFormula('-12.5')).toBe('-12.5');
    expect(guardFormula('-0')).toBe('-0');
  });
  it("prefixe les formules de tableur", () => {
    expect(guardFormula('=SOMME(A1)')).toBe("'=SOMME(A1)");
    expect(guardFormula('+1')).toBe("'+1");
    expect(guardFormula('@val')).toBe("'@val");
  });
  it("ne touche pas aux chaines normales", () => {
    expect(guardFormula('bonjour')).toBe('bonjour');
    expect(guardFormula('2024-01-01')).toBe('2024-01-01');
  });
});

describe('csvCell', () => {
  it("retourne vide pour null", () => {
    expect(csvCell(null)).toBe('');
  });
  it("formate les nombres", () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(-3.14)).toBe('-3.14');
  });
  it("retourne vide pour NaN ou Infinity", () => {
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(Infinity)).toBe('');
  });
  it("entoure de guillemets si virgule ou saut de ligne", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it("echappe les guillemets doubles", () => {
    expect(csvCell('"hello"')).toBe('"""hello"""');
  });
});

describe('toCsv', () => {
  it("genere un CSV complet", () => {
    type Row = { date: string; temp: number | null };
    const rows: Row[] = [
      { date: '2000-01-01', temp: 24.5 },
      { date: '2000-01-02', temp: null },
    ];
    const cols = [
      { header: 'Date', value: (r: Row) => r.date },
      { header: 'Temp. (C)', value: (r: Row) => r.temp },
    ];
    const csv = toCsv(rows, cols);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Temp. (C)');
    expect(lines[1]).toBe('2000-01-01,24.5');
    expect(lines[2]).toBe('2000-01-02,');
  });
});
