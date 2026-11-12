/**
 * Tests du pipeline ETL : transformation, idempotence, snapshots successifs,
 * verrou d'exécution, rétention et mode simulation.
 * Aucun appel réseau : les extracteurs sont injectés.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EtlConfig } from '../etl/config.js';
import {
  acquireLock,
  applyRetention,
  openDatabase,
  releaseLock,
} from '../etl/db.js';
import { archiveWindow } from '../etl/extract.js';
import { runEtl, type EtlLogger } from '../etl/run.js';
import { transformForecast } from '../etl/transform.js';
import { normalizeArchive, normalizeForecast, type ArchiveChunkResult } from '../server/lib/openMeteo.js';
import type { ForecastPayload } from '../shared/types.js';

const silentLogger: EtlLogger = { info: () => {}, warn: () => {}, error: () => {} };
const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meteo-etl-'));
  tempDirs.push(dir);
  return path.join(dir, 'meteo.sqlite');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function forecastRaw(temperature: number | null, precipitation: number | null = 0) {
  return {
    latitude: -18.8792,
    longitude: 47.5079,
    timezone: 'Indian/Antananarivo',
    timezone_abbreviation: 'EAT',
    utc_offset_seconds: 10_800,
    current_units: {
      temperature_2m: '°C',
      apparent_temperature: '°C',
      relative_humidity_2m: '%',
      precipitation: 'mm',
      weather_code: '',
      wind_speed_10m: 'km/h',
    },
    current: {
      time: '2026-11-11T15:00',
      interval: 900,
      temperature_2m: temperature,
      apparent_temperature: temperature,
      relative_humidity_2m: 70,
      precipitation,
      weather_code: 2,
      wind_speed_10m: 11.5,
    },
    hourly_units: {
      temperature_2m: '°C',
      relative_humidity_2m: '%',
      precipitation_probability: '%',
      precipitation: 'mm',
      wind_speed_10m: 'km/h',
    },
    hourly: {
      time: ['2026-11-11T15:00', '2026-11-11T16:00'],
      temperature_2m: [temperature, null],
      relative_humidity_2m: [70, 68],
      precipitation_probability: [10, null],
      precipitation: [precipitation, 0],
      wind_speed_10m: [11.5, 10.2],
    },
    daily_units: {
      temperature_2m_mean: '°C',
      temperature_2m_max: '°C',
      temperature_2m_min: '°C',
      precipitation_sum: 'mm',
    },
    daily: {
      time: ['2026-11-11'],
      temperature_2m_mean: [temperature],
      temperature_2m_max: [temperature === null ? null : temperature + 4],
      temperature_2m_min: [temperature === null ? null : temperature - 4],
      precipitation_sum: [precipitation],
    },
  };
}

function forecastPayload(temperature: number | null): ForecastPayload {
  return normalizeForecast(forecastRaw(temperature));
}

function archiveChunk(temperature = 24): ArchiveChunkResult {
  return normalizeArchive({
    latitude: -18.8792,
    longitude: 47.5079,
    timezone: 'Indian/Antananarivo',
    timezone_abbreviation: 'EAT',
    utc_offset_seconds: 10_800,
    daily_units: {
      temperature_2m_mean: '°C',
      temperature_2m_max: '°C',
      temperature_2m_min: '°C',
      precipitation_sum: 'mm',
    },
    daily: {
      time: ['2026-11-04', '2026-11-05'],
      temperature_2m_mean: [temperature, null],
      temperature_2m_max: [temperature + 3, null],
      temperature_2m_min: [temperature - 3, null],
      precipitation_sum: [0, null],
    },
  });
}

function config(dbPath: string): EtlConfig {
  return {
    dbPath,
    locations: [{ latitude: -18.8792, longitude: 47.5079, label: 'Antananarivo' }],
    forecastDays: 7,
    archiveDays: 7,
    retentionDays: 90,
    lockTtlMinutes: 30,
    trigger: 'test',
  };
}

function countRows(dbPath: string, sql: string): number {
  const db = openDatabase(dbPath);
  try {
    const row = db.prepare(sql).get() as { total: number };
    return Number(row.total);
  } finally {
    db.close();
  }
}

describe('transformForecast', () => {
  it('conserve les valeurs manquantes en null et associe les unités', () => {
    const snapshot = transformForecast(forecastPayload(null), 7);
    const hourly = snapshot.observations.filter(
      (row) => row.granularity === 'hourly' && row.variable === 'temperature_2m',
    );
    expect(hourly).toHaveLength(2);
    expect(hourly[1]?.value).toBeNull();
    expect(hourly[0]?.unit).toBe('°C');

    const current = snapshot.observations.filter((row) => row.granularity === 'current');
    expect(current.find((row) => row.variable === 'temperature_2m')?.value).toBeNull();
    // Un zéro réel n'est pas une donnée manquante.
    expect(current.find((row) => row.variable === 'precipitation')?.value).toBe(0);
  });

  it('produit une empreinte stable indépendante de l’heure de collecte', () => {
    const first = transformForecast(forecastPayload(25), 7);
    const second = transformForecast(forecastPayload(25), 7);
    expect(second.contentHash).toBe(first.contentHash);

    const changed = transformForecast(forecastPayload(26), 7);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });
});

describe('runEtl', () => {
  it('est idempotent sur un contenu inchangé et journalise les deux exécutions', async () => {
    const dbPath = tempDbPath();
    const payload = forecastPayload(24);
    const chunk = archiveChunk();
    const deps = {
      fetchForecast: async () => payload,
      fetchArchive: async () => [chunk],
      now: () => new Date('2026-11-11T12:00:00Z'),
    };

    const first = await runEtl({ config: config(dbPath), deps, logger: silentLogger });
    expect(first.status).toBe('success');
    expect(first.snapshotsInserted).toBe(2);
    expect(first.newData).toBe(true);

    const second = await runEtl({ config: config(dbPath), deps, logger: silentLogger });
    expect(second.status).toBe('success');
    expect(second.snapshotsInserted).toBe(0);
    expect(second.snapshotsSkipped).toBe(2);
    expect(second.newData).toBe(false);

    expect(countRows(dbPath, 'SELECT COUNT(*) AS total FROM snapshots')).toBe(2);
    expect(countRows(dbPath, 'SELECT COUNT(*) AS total FROM ingestion_runs')).toBe(2);
  });

  it('préserve les anciens snapshots quand les prévisions changent', async () => {
    const dbPath = tempDbPath();
    const chunk = archiveChunk();
    let temperature = 24;
    const deps = {
      fetchForecast: async () => forecastPayload(temperature),
      fetchArchive: async () => [chunk],
      now: () => new Date('2026-11-11T12:00:00Z'),
    };

    const first = await runEtl({ config: config(dbPath), deps, logger: silentLogger });
    expect(first.status).toBe('success');

    temperature = 29;
    const second = await runEtl({ config: config(dbPath), deps, logger: silentLogger });
    expect(second.snapshotsInserted).toBe(1);
    expect(second.newData).toBe(true);

    expect(countRows(dbPath, 'SELECT COUNT(*) AS total FROM snapshots')).toBe(3);
    expect(
      countRows(
        dbPath,
        "SELECT COUNT(*) AS total FROM snapshots WHERE kind = 'forecast'",
      ),
    ).toBe(2);

    const db = openDatabase(dbPath);
    try {
      const rows = db
        .prepare(
          `SELECT o.value FROM observations o
           JOIN snapshots s ON s.id = o.snapshot_id
           WHERE s.kind = 'forecast' AND s.id = (SELECT MIN(id) FROM snapshots)
             AND o.granularity = 'current' AND o.variable = 'temperature_2m'`,
        )
        .all() as { value: number }[];
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.value)).toBe(24);
    } finally {
      db.close();
    }
  });

  it('purge les anciens snapshots et leurs observations', async () => {
    const dbPath = tempDbPath();
    const deps = {
      fetchForecast: async () => forecastPayload(24),
      fetchArchive: async () => [archiveChunk()],
      now: () => new Date('2026-11-11T12:00:00Z'),
    };
    await runEtl({ config: config(dbPath), deps, logger: silentLogger });

    const db = openDatabase(dbPath);
    try {
      expect(applyRetention(db, '9999-01-01')).toBe(2);
      const remaining = db.prepare('SELECT COUNT(*) AS total FROM observations').get() as {
        total: number;
      };
      expect(Number(remaining.total)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('refuse une seconde collecte concurrente', async () => {
    const dbPath = tempDbPath();
    const db = openDatabase(dbPath);
    try {
      const now = new Date('2026-11-11T12:00:00Z');
      expect(acquireLock(db, 'processus-a', now, 30)).toBe(true);
      expect(acquireLock(db, 'processus-b', now, 30)).toBe(false);
      releaseLock(db, 'processus-a');
      expect(acquireLock(db, 'processus-b', now, 30)).toBe(true);
    } finally {
      db.close();
    }

    const summary = await runEtl({
      config: config(dbPath),
      deps: {
        fetchForecast: async () => forecastPayload(24),
        fetchArchive: async () => [archiveChunk()],
        now: () => new Date('2026-11-11T12:00:00Z'),
      },
      logger: silentLogger,
    });
    expect(summary.status).toBe('locked');
    expect(summary.snapshotsInserted).toBe(0);
  });

  it('ne crée aucune base en mode simulation', async () => {
    const dbPath = tempDbPath();
    const summary = await runEtl({
      config: config(dbPath),
      dryRun: true,
      deps: {
        fetchForecast: async () => forecastPayload(24),
        fetchArchive: async () => [archiveChunk()],
        now: () => new Date('2026-11-11T12:00:00Z'),
      },
      logger: silentLogger,
    });

    expect(summary.status).toBe('dry-run');
    expect(summary.locations[0]?.forecastRows).toBeGreaterThan(0);
    expect(summary.locations[0]?.archiveRows).toBeGreaterThan(0);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

describe('archiveWindow', () => {
  it('respecte le délai de publication ERA5', () => {
    expect(archiveWindow(7, '2026-11-11')).toEqual({ start: '2026-10-30', end: '2026-11-05' });
  });
});
