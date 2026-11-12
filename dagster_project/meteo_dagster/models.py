"""Objets métier partagés entre assets et ressources."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

Granularity = Literal["current", "hourly", "daily"]
SnapshotKind = Literal["forecast", "archive"]


@dataclass(frozen=True)
class Location:
    latitude: float
    longitude: float
    label: str | None = None

    @property
    def key(self) -> str:
        return f"{self.latitude:.6f},{self.longitude:.6f}"


@dataclass(frozen=True)
class Observation:
    granularity: Granularity
    valid_time: str
    variable: str
    value: float | None
    unit: str | None


@dataclass(frozen=True)
class TransformedSnapshot:
    kind: SnapshotKind
    source: str
    model: str | None
    timezone: str
    timezone_abbreviation: str
    utc_offset_seconds: int
    forecast_days: int | None
    observations: tuple[Observation, ...]
    content_hash: str


@dataclass(frozen=True)
class RawDocument:
    """Document brut écrit sur disque, avec les payloads pour l'asset aval."""

    path: str
    kind: SnapshotKind
    fetched_at: datetime
    locations: tuple[Location, ...]
    forecast_days: int | None
    partition_key: str | None
    payloads: dict[str, dict]


@dataclass(frozen=True)
class LoadResult:
    inserted: bool
    observation_count: int


@dataclass(frozen=True)
class SnapshotQuality:
    snapshot_id: int
    fetched_at: str
    observation_count: int
    temperature_values: int
    temperature_non_null: int


@dataclass(frozen=True)
class PartitionLoadStats:
    snapshot_count: int
    observation_count: int
    locations: int
