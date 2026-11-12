"""Entrepôt SQLite : idempotence, qualité, partitions et rétention."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from meteo_dagster.models import Location
from meteo_dagster.resources import WarehouseResource
from meteo_dagster.schemas import parse_archive, parse_forecast
from meteo_dagster.transform import transform_archive, transform_forecast

LOCATION = Location(-18.8792, 47.5079, "Antananarivo")


@pytest.fixture
def warehouse(tmp_path: Path) -> WarehouseResource:
    return WarehouseResource(path=str(tmp_path / "warehouse.sqlite"))


def _forecast_snapshot(forecast_payload: dict):
    return transform_forecast(parse_forecast(forecast_payload), forecast_days=7)


def test_save_snapshot_is_idempotent(
    warehouse: WarehouseResource, forecast_payload: dict
) -> None:
    snapshot = _forecast_snapshot(forecast_payload)
    fetched_at = datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc)

    first = warehouse.save_snapshot(
        LOCATION, snapshot, fetched_at=fetched_at, asset="forecast_snapshot"
    )
    second = warehouse.save_snapshot(
        LOCATION, snapshot, fetched_at=fetched_at, asset="forecast_snapshot"
    )

    assert first.inserted is True
    assert first.observation_count == 24
    assert second.inserted is False
    assert second.observation_count == 24


def test_save_different_content_creates_new_snapshot(
    warehouse: WarehouseResource, forecast_payload: dict
) -> None:
    fetched_at = datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc)
    first = warehouse.save_snapshot(
        LOCATION,
        _forecast_snapshot(forecast_payload),
        fetched_at=fetched_at,
        asset="forecast_snapshot",
    )

    updated = {**forecast_payload, "current": dict(forecast_payload["current"])}
    updated["current"]["temperature_2m"] = 27.0
    second = warehouse.save_snapshot(
        LOCATION,
        _forecast_snapshot(updated),
        fetched_at=fetched_at + timedelta(hours=1),
        asset="forecast_snapshot",
    )

    assert first.inserted and second.inserted


def test_latest_quality_counts_temperature_values(
    warehouse: WarehouseResource, forecast_payload: dict
) -> None:
    warehouse.save_snapshot(
        LOCATION,
        _forecast_snapshot(forecast_payload),
        fetched_at=datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc),
        asset="forecast_snapshot",
    )

    quality = warehouse.latest_quality(LOCATION, "forecast")

    assert quality is not None
    assert quality.observation_count == 24
    # Seules les séries nommées exactement temperature_2m sont comptées :
    # conditions courantes + 2 heures, dont une valeur horaire nulle.
    assert quality.temperature_values == 3
    assert quality.temperature_non_null == 2


def test_partition_stats_and_archive_load(
    warehouse: WarehouseResource, archive_payload: dict
) -> None:
    warehouse.save_snapshot(
        LOCATION,
        transform_archive(parse_archive(archive_payload)),
        fetched_at=datetime(2025, 1, 22, 6, 0, tzinfo=timezone.utc),
        asset="archive_snapshot",
        partition_key="2025-01-15",
    )

    stats = warehouse.partition_stats("2025-01-15")

    assert stats.snapshot_count == 1
    assert stats.observation_count == 4
    assert stats.locations == 1
    assert warehouse.partition_stats("2025-01-16").snapshot_count == 0


def test_purge_removes_only_old_forecasts(
    warehouse: WarehouseResource, forecast_payload: dict, archive_payload: dict
) -> None:
    now = datetime(2025, 3, 1, tzinfo=timezone.utc)
    warehouse.save_snapshot(
        LOCATION,
        _forecast_snapshot(forecast_payload),
        fetched_at=now - timedelta(days=120),
        asset="forecast_snapshot",
    )
    recent = {**forecast_payload, "current": dict(forecast_payload["current"])}
    recent["current"]["temperature_2m"] = 28.5
    warehouse.save_snapshot(
        LOCATION,
        _forecast_snapshot(recent),
        fetched_at=now,
        asset="forecast_snapshot",
    )
    warehouse.save_snapshot(
        LOCATION,
        transform_archive(parse_archive(archive_payload)),
        fetched_at=now - timedelta(days=400),
        asset="archive_snapshot",
        partition_key="2024-01-25",
    )

    deleted = warehouse.purge_forecast_snapshots_before(
        (now - timedelta(days=90)).isoformat()
    )

    assert deleted == 1
    assert warehouse.latest_quality(LOCATION, "forecast") is not None
    assert warehouse.partition_stats("2024-01-25").snapshot_count == 1
