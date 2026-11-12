/**
 * Couche de stockage SQLite du pipeline ETL.
 * - une seule connexion par processus, écritures sérialisées par un verrou applicatif ;
 * - chaque collecte crée un journal dans `ingestion_runs` ;
 * - chaque contenu réellement nouveau crée un snapshot immuable + ses observations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from './sqlite.js';
import { MIGRATIONS } from './migrations.js';

export type SnapKind = 'forecast' | 'archive';
export type Granularity = 'current' | 'hourly' | 'daily';
export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'locked';

export interface ObservationRow {
  granularity: Granularity;
  validTime: string;
  variable: string;
  value: number | null;
  unit: string | null;
}

export interface SnapshotInput {
  runId: number;
  locationId: number;
  kind: SnapKind;
  fetchedAt: string;
  source: string;
  model: string | null;
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  forecastDays: number | null;
  contentHash: string;
  observations: ObservationRow[];
}

export interface RunUpdate {
  status: RunStatus;
  locationsRequested: number;
  locationsSucceeded: number;
  locationsFailed: number;
  snapshotsInserted: number;
  snapshotsSkipped: number;
  observationsInserted: number;
  dataChanged: boolean;
  retentionDeleted: number;
  error?: string | null;
}

export class EtlDatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EtlDatabaseError';
  }
}

/** Ouvre (et migre au besoin) la base. `:memory:` est accepté pour les tests. */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

export function openDatabaseReadOnly(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const current = Number(row?.user_version ?? 0);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new EtlDatabaseError(`Migration ${migration.version} échouée`, { cause: error });
    }
  }
}

/**
 * Verrou d'exécution atomique : un seul collecteur écrit à la fois.
 * Un verrou expiré (processus interrompu) peut être repris.
 */
export function acquireLock(db: DatabaseSync, owner: string, now: Date, ttlMinutes: number): boolean {
  const acquiredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const result = db
    .prepare(
      `INSERT INTO etl_lock (id, owner, acquired_at, expires_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         owner = excluded.owner,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at
       WHERE etl_lock.expires_at <= excluded.acquired_at`,
    )
    .run(owner, acquiredAt, expiresAt);
  return Number(result.changes) === 1;
}

export function releaseLock(db: DatabaseSync, owner: string): void {
  db.prepare('DELETE FROM etl_lock WHERE id = 1 AND owner = ?').run(owner);
}

/**
 * Marque comme échouées les exécutions restées « running » après un arrêt brutal.
 * Appelé une fois le verrou obtenu : aucun run actif ne peut alors être écrasé.
 */
export function failStaleRuns(db: DatabaseSync, now: Date): number {
  const result = db
    .prepare(
      `UPDATE ingestion_runs
       SET status = 'failed',
           finished_at = ?,
           error = COALESCE(error, 'Exécution interrompue avant la fin')
       WHERE status = 'running'`,
    )
    .run(now.toISOString());
  return Number(result.changes);
}

export function startRun(db: DatabaseSync, trigger: string, now: Date, requested: number): number {
  const result = db
    .prepare(
      `INSERT INTO ingestion_runs (started_at, status, trigger, locations_requested)
       VALUES (?, 'running', ?, ?)`,
    )
    .run(now.toISOString(), trigger, requested);
  return Number(result.lastInsertRowid);
}

export function finishRun(db: DatabaseSync, runId: number, now: Date, update: RunUpdate): void {
  db.prepare(
    `UPDATE ingestion_runs SET
       finished_at = ?,
       status = ?,
       locations_succeeded = ?,
       locations_failed = ?,
       snapshots_inserted = ?,
       snapshots_skipped = ?,
       observations_inserted = ?,
       data_changed = ?,
       retention_deleted = ?,
       error = ?
     WHERE id = ?`,
  ).run(
    now.toISOString(),
    update.status,
    update.locationsSucceeded,
    update.locationsFailed,
    update.snapshotsInserted,
    update.snapshotsSkipped,
    update.observationsInserted,
    update.dataChanged ? 1 : 0,
    update.retentionDeleted,
    update.error ?? null,
    runId,
  );
}

export function getOrCreateLocation(
  db: DatabaseSync,
  latitude: number,
  longitude: number,
  label: string | null,
  now: Date,
): number {
  db.prepare(
    `INSERT INTO locations (latitude, longitude, label, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (latitude, longitude) DO UPDATE SET label = COALESCE(excluded.label, locations.label)`,
  ).run(latitude, longitude, label, now.toISOString());

  const row = db
    .prepare('SELECT id FROM locations WHERE latitude = ? AND longitude = ?')
    .get(latitude, longitude) as { id: number } | undefined;
  if (!row) throw new EtlDatabaseError('Localisation introuvable après insertion');
  return Number(row.id);
}

/**
 * Insère un snapshot complet ou ne fait rien si le même contenu a déjà été
 * collecté (même localisation, même nature, même empreinte). Retourne true si
 * de nouvelles données ont été écrites.
 */
export function insertSnapshot(db: DatabaseSync, snapshot: SnapshotInput): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db
      .prepare(
        `INSERT INTO snapshots (
           run_id, location_id, kind, fetched_at, source, model, timezone,
           timezone_abbreviation, utc_offset_seconds, forecast_days,
           content_hash, observation_count, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (location_id, kind, content_hash) DO NOTHING`,
      )
      .run(
        snapshot.runId,
        snapshot.locationId,
        snapshot.kind,
        snapshot.fetchedAt,
        snapshot.source,
        snapshot.model,
        snapshot.timezone,
        snapshot.timezoneAbbreviation,
        snapshot.utcOffsetSeconds,
        snapshot.forecastDays,
        snapshot.contentHash,
        snapshot.observations.length,
        snapshot.fetchedAt,
      );

    if (Number(result.changes) !== 1) {
      db.exec('ROLLBACK');
      return false;
    }

    const snapshotId = Number(result.lastInsertRowid);
    const insertObservation = db.prepare(
      `INSERT INTO observations (snapshot_id, granularity, valid_time, variable, value, unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const observation of snapshot.observations) {
      insertObservation.run(
        snapshotId,
        observation.granularity,
        observation.validTime,
        observation.variable,
        observation.value,
        observation.unit,
      );
    }

    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Purge les snapshots antérieurs à `cutoffIso` (observations supprimées en cascade). */
export function applyRetention(db: DatabaseSync, cutoffIso: string): number {
  const result = db.prepare('DELETE FROM snapshots WHERE fetched_at < ?').run(cutoffIso);
  return Number(result.changes);
}

export interface EtlStatus {
  dbPath: string;
  locations: { latitude: number; longitude: number; label: string | null }[];
  runs: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    snapshotsInserted: number;
    observationsInserted: number;
    dataChanged: boolean;
  }[];
  snapshots: { forecast: number; archive: number };
  observations: number;
  latestFetchedAt: string | null;
  lock: { owner: string; expiresAt: string } | null;
}

export function getStatus(db: DatabaseSync, dbPath: string): EtlStatus {
  const locations = db
    .prepare('SELECT latitude, longitude, label FROM locations ORDER BY id')
    .all() as { latitude: number; longitude: number; label: string | null }[];

  const runs = (
    db
      .prepare(
        `SELECT id, started_at, finished_at, status, snapshots_inserted, observations_inserted, data_changed
         FROM ingestion_runs ORDER BY id DESC LIMIT 10`,
      )
      .all() as {
      id: number;
      started_at: string;
      finished_at: string | null;
      status: string;
      snapshots_inserted: number;
      observations_inserted: number;
      data_changed: number;
    }[]
  ).map((row) => ({
    id: Number(row.id),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    snapshotsInserted: Number(row.snapshots_inserted),
    observationsInserted: Number(row.observations_inserted),
    dataChanged: Number(row.data_changed) === 1,
  }));

  const counts = db
    .prepare('SELECT kind, COUNT(*) AS total FROM snapshots GROUP BY kind')
    .all() as { kind: string; total: number }[];
  const snapshots = { forecast: 0, archive: 0 };
  for (const count of counts) {
    if (count.kind === 'forecast' || count.kind === 'archive') {
      snapshots[count.kind] = Number(count.total);
    }
  }

  const observationRow = db.prepare('SELECT COUNT(*) AS total FROM observations').get() as
    | { total: number }
    | undefined;
  const latestRow = db.prepare('SELECT MAX(fetched_at) AS latest FROM snapshots').get() as
    | { latest: string | null }
    | undefined;
  const lockRow = db.prepare('SELECT owner, expires_at FROM etl_lock WHERE id = 1').get() as
    | { owner: string; expires_at: string }
    | undefined;

  return {
    dbPath,
    locations: locations.map((location) => ({
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      label: location.label,
    })),
    runs,
    snapshots,
    observations: Number(observationRow?.total ?? 0),
    latestFetchedAt: latestRow?.latest ?? null,
    lock: lockRow ? { owner: lockRow.owner, expiresAt: lockRow.expires_at } : null,
  };
}
