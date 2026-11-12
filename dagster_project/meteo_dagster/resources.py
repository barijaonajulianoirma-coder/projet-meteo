"""Ressources Dagster : accès Open-Meteo et entrepôt SQLite."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import requests
from dagster import Config, ConfigurableResource
from pydantic import Field
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .models import (
    LoadResult,
    Location,
    PartitionLoadStats,
    SnapshotKind,
    SnapshotQuality,
    TransformedSnapshot,
)

FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"

FORECAST_CURRENT = (
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
)
FORECAST_HOURLY = (
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation_probability",
    "precipitation",
    "wind_speed_10m",
)
DAILY_VARIABLES = (
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
)


class OpenMeteoError(RuntimeError):
    """Échec contrôlé d'un appel Open-Meteo."""


class OpenMeteoResource(ConfigurableResource):
    forecast_endpoint: str = FORECAST_ENDPOINT
    archive_endpoint: str = ARCHIVE_ENDPOINT
    timeout_seconds: int = 20
    max_retries: int = 3
    backoff_factor: float = 0.5
    user_agent: str = "meteo-dagster/0.1 (+https://open-meteo.com/)"

    def _session(self) -> requests.Session:
        session = requests.Session()
        retry = Retry(
            total=self.max_retries,
            connect=self.max_retries,
            read=self.max_retries,
            status=self.max_retries,
            backoff_factor=self.backoff_factor,
            status_forcelist=(408, 425, 429, 500, 502, 503, 504),
            allowed_methods=("GET",),
            respect_retry_after_header=True,
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        session.headers.update({"Accept": "application/json", "User-Agent": self.user_agent})
        return session

    def _get(self, url: str, params: dict[str, str | int]) -> dict:
        with self._session() as session:
            try:
                response = session.get(url, params=params, timeout=self.timeout_seconds)
            except requests.RequestException as exc:
                raise OpenMeteoError(f"Réseau Open-Meteo indisponible : {exc}") from exc

        if response.status_code >= 400:
            reason = ""
            try:
                body = response.json()
                reason = body.get("reason") or body.get("error") or ""
            except ValueError:
                reason = response.text[:200]
            raise OpenMeteoError(f"Open-Meteo HTTP {response.status_code} : {reason or 'sans détail'}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise OpenMeteoError("Open-Meteo a renvoyé un JSON invalide") from exc

        if not isinstance(payload, dict):
            raise OpenMeteoError("Open-Meteo a renvoyé une structure inattendue")
        if payload.get("error") is True:
            raise OpenMeteoError(str(payload.get("reason") or "Erreur signalée par Open-Meteo"))
        return payload

    def fetch_forecast(self, latitude: float, longitude: float, forecast_days: int) -> dict:
        params: dict[str, str | int] = {
            "latitude": latitude,
            "longitude": longitude,
            "current": ",".join(FORECAST_CURRENT),
            "hourly": ",".join(FORECAST_HOURLY),
            "daily": ",".join(DAILY_VARIABLES),
            "timezone": "auto",
            "forecast_days": forecast_days,
        }
        return self._get(self.forecast_endpoint, params)

    def fetch_archive(self, latitude: float, longitude: float, start_date: str, end_date: str) -> dict:
        params: dict[str, str | int] = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "daily": ",".join(DAILY_VARIABLES),
            "models": "era5",
            "timezone": "auto",
        }
        return self._get(self.archive_endpoint, params)


class LocationConfig(Config):
    latitude: float
    longitude: float
    label: str | None = None


class MeteoConfigResource(ConfigurableResource):
    locations: list[LocationConfig] = Field(
        default_factory=lambda: [
            LocationConfig(latitude=-18.8792, longitude=47.5079, label="Antananarivo")
        ]
    )
    forecast_days: int = 7
    retention_days: int = 90
    raw_dir: str = "data/raw"

    def location_list(self) -> tuple[Location, ...]:
        return tuple(
            Location(latitude=item.latitude, longitude=item.longitude, label=item.label)
            for item in self.locations
        )


SCHEMA_VERSION = 1

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations (id),
  kind TEXT NOT NULL CHECK (kind IN ('forecast', 'archive')),
  source TEXT NOT NULL,
  model TEXT,
  fetched_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  timezone_abbreviation TEXT NOT NULL,
  utc_offset_seconds INTEGER NOT NULL,
  forecast_days INTEGER,
  partition_key TEXT,
  content_hash TEXT NOT NULL,
  observation_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (location_id, kind, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_partition
  ON snapshots (kind, partition_key);
CREATE INDEX IF NOT EXISTS idx_snapshots_fetched
  ON snapshots (kind, fetched_at);

CREATE TABLE IF NOT EXISTS observations (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  granularity TEXT NOT NULL CHECK (granularity IN ('current', 'hourly', 'daily')),
  valid_time TEXT NOT NULL,
  variable TEXT NOT NULL,
  value REAL,
  unit TEXT,
  PRIMARY KEY (snapshot_id, granularity, valid_time, variable)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_observations_variable
  ON observations (variable, valid_time);

CREATE TABLE IF NOT EXISTS load_events (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  asset TEXT NOT NULL,
  partition_key TEXT,
  dagster_run_id TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('inserted', 'unchanged')),
  observation_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_load_events_occurred
  ON load_events (occurred_at);

CREATE VIEW IF NOT EXISTS v_observations AS
  SELECT
    l.latitude, l.longitude, l.label,
    s.kind, s.fetched_at, s.source, s.model, s.partition_key,
    s.id AS snapshot_id,
    o.granularity, o.valid_time, o.variable, o.value, o.unit
  FROM observations o
  JOIN snapshots s ON s.id = o.snapshot_id
  JOIN locations l ON l.id = s.location_id;
"""


class WarehouseResource(ConfigurableResource):
    path: str = "data/dagster_meteo.sqlite"

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        if self.path != ":memory:":
            Path(self.path).resolve().parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            self._migrate(connection)
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _migrate(self, connection: sqlite3.Connection) -> None:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version < SCHEMA_VERSION:
            connection.executescript(SCHEMA_SQL)
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def save_snapshot(
        self,
        location: Location,
        snapshot: TransformedSnapshot,
        *,
        fetched_at: datetime,
        asset: str,
        dagster_run_id: str | None = None,
        partition_key: str | None = None,
    ) -> LoadResult:
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO locations (latitude, longitude, label, created_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT (latitude, longitude)
                   DO UPDATE SET label = COALESCE(excluded.label, locations.label)""",
                (location.latitude, location.longitude, location.label, now),
            )
            location_row = connection.execute(
                "SELECT id FROM locations WHERE latitude = ? AND longitude = ?",
                (location.latitude, location.longitude),
            ).fetchone()
            if location_row is None:
                raise RuntimeError("Localisation introuvable après insertion")
            location_id = int(location_row["id"])

            cursor = connection.execute(
                """INSERT INTO snapshots (
                     location_id, kind, source, model, fetched_at, timezone,
                     timezone_abbreviation, utc_offset_seconds, forecast_days,
                     partition_key, content_hash, observation_count, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (location_id, kind, content_hash) DO NOTHING""",
                (
                    location_id,
                    snapshot.kind,
                    snapshot.source,
                    snapshot.model,
                    fetched_at.isoformat(),
                    snapshot.timezone,
                    snapshot.timezone_abbreviation,
                    snapshot.utc_offset_seconds,
                    snapshot.forecast_days,
                    partition_key,
                    snapshot.content_hash,
                    len(snapshot.observations),
                    now,
                ),
            )
            inserted = cursor.rowcount == 1
            if inserted:
                snapshot_id = int(cursor.lastrowid)
                connection.executemany(
                    """INSERT INTO observations (
                         snapshot_id, granularity, valid_time, variable, value, unit
                       ) VALUES (?, ?, ?, ?, ?, ?)""",
                    [
                        (
                            snapshot_id,
                            row.granularity,
                            row.valid_time,
                            row.variable,
                            row.value,
                            row.unit,
                        )
                        for row in snapshot.observations
                    ],
                )

            connection.execute(
                """INSERT INTO load_events (
                     occurred_at, asset, partition_key, dagster_run_id, latitude,
                     longitude, kind, status, observation_count
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    now,
                    asset,
                    partition_key,
                    dagster_run_id,
                    location.latitude,
                    location.longitude,
                    snapshot.kind,
                    "inserted" if inserted else "unchanged",
                    len(snapshot.observations),
                ),
            )

        return LoadResult(inserted=inserted, observation_count=len(snapshot.observations))

    def latest_quality(self, location: Location, kind: SnapshotKind) -> SnapshotQuality | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT
                     s.id, s.fetched_at, s.observation_count,
                     COUNT(CASE WHEN o.variable = 'temperature_2m' THEN 1 END) AS temperature_values,
                     COUNT(CASE WHEN o.variable = 'temperature_2m' AND o.value IS NOT NULL THEN 1 END)
                       AS temperature_non_null
                   FROM snapshots s
                   LEFT JOIN observations o ON o.snapshot_id = s.id
                   WHERE s.id = (
                     SELECT id FROM snapshots
                     WHERE location_id = (
                       SELECT id FROM locations WHERE latitude = ? AND longitude = ?
                     ) AND kind = ?
                     ORDER BY fetched_at DESC, id DESC
                     LIMIT 1
                   )
                   GROUP BY s.id""",
                (location.latitude, location.longitude, kind),
            ).fetchone()

        if row is None:
            return None
        return SnapshotQuality(
            snapshot_id=int(row["id"]),
            fetched_at=str(row["fetched_at"]),
            observation_count=int(row["observation_count"]),
            temperature_values=int(row["temperature_values"]),
            temperature_non_null=int(row["temperature_non_null"]),
        )

    def partition_stats(self, partition_key: str) -> PartitionLoadStats:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT
                     COUNT(*) AS snapshot_count,
                     COALESCE(SUM(observation_count), 0) AS observation_count,
                     COUNT(DISTINCT location_id) AS locations
                   FROM snapshots
                   WHERE kind = 'archive' AND partition_key = ?""",
                (partition_key,),
            ).fetchone()
        if row is None:  # pragma: no cover - COUNT renvoie toujours une ligne
            return PartitionLoadStats(0, 0, 0)
        return PartitionLoadStats(
            snapshot_count=int(row["snapshot_count"]),
            observation_count=int(row["observation_count"]),
            locations=int(row["locations"]),
        )

    def purge_forecast_snapshots_before(self, cutoff_iso: str) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM snapshots WHERE kind = 'forecast' AND fetched_at < ?",
                (cutoff_iso,),
            )
            return int(cursor.rowcount)
