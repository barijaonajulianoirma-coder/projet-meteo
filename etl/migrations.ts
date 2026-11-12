/**
 * Migrations SQLite versionnées via `PRAGMA user_version`.
 * Ajouter une migration = ajouter une entrée en fin de tableau, jamais modifier
 * une migration déjà appliquée sur une base existante.
 */

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE locations (
        id INTEGER PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (latitude, longitude)
      ) STRICT;

      CREATE TABLE ingestion_runs (
        id INTEGER PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'locked')),
        trigger TEXT NOT NULL,
        locations_requested INTEGER NOT NULL DEFAULT 0,
        locations_succeeded INTEGER NOT NULL DEFAULT 0,
        locations_failed INTEGER NOT NULL DEFAULT 0,
        snapshots_inserted INTEGER NOT NULL DEFAULT 0,
        snapshots_skipped INTEGER NOT NULL DEFAULT 0,
        observations_inserted INTEGER NOT NULL DEFAULT 0,
        data_changed INTEGER NOT NULL DEFAULT 0 CHECK (data_changed IN (0, 1)),
        retention_deleted INTEGER NOT NULL DEFAULT 0,
        error TEXT
      ) STRICT;

      CREATE INDEX idx_runs_started_at ON ingestion_runs (started_at);

      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES ingestion_runs (id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES locations (id),
        kind TEXT NOT NULL CHECK (kind IN ('forecast', 'archive')),
        fetched_at TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT,
        timezone TEXT NOT NULL,
        timezone_abbreviation TEXT NOT NULL,
        utc_offset_seconds INTEGER NOT NULL,
        forecast_days INTEGER,
        content_hash TEXT NOT NULL,
        observation_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (location_id, kind, content_hash)
      ) STRICT;

      CREATE INDEX idx_snapshots_location_kind ON snapshots (location_id, kind, fetched_at);

      CREATE TABLE observations (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
        granularity TEXT NOT NULL CHECK (granularity IN ('current', 'hourly', 'daily')),
        valid_time TEXT NOT NULL,
        variable TEXT NOT NULL,
        value REAL,
        unit TEXT,
        PRIMARY KEY (snapshot_id, granularity, valid_time, variable)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX idx_observations_valid_time ON observations (valid_time);
      CREATE INDEX idx_observations_variable ON observations (variable, valid_time);

      CREATE TABLE etl_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;

      CREATE VIEW v_observations AS
        SELECT
          l.latitude,
          l.longitude,
          l.label,
          s.kind,
          s.fetched_at,
          s.source,
          s.model,
          s.id AS snapshot_id,
          o.granularity,
          o.valid_time,
          o.variable,
          o.value,
          o.unit
        FROM observations o
        JOIN snapshots s ON s.id = o.snapshot_id
        JOIN locations l ON l.id = s.location_id;

      CREATE VIEW v_latest_snapshots AS
        SELECT s.*
        FROM snapshots s
        WHERE s.id = (
          SELECT s2.id
          FROM snapshots s2
          WHERE s2.location_id = s.location_id AND s2.kind = s.kind
          ORDER BY s2.fetched_at DESC, s2.id DESC
          LIMIT 1
        );
    `,
  },
];
