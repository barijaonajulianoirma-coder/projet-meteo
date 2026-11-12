"""Matérialisation des assets sans réseau (Open-Meteo simulé)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from dagster import materialize

from meteo_dagster.assets import (
    archive_quality,
    archive_raw,
    archive_snapshot,
    forecast_quality,
    forecast_raw,
    forecast_snapshot,
    retention,
)
from meteo_dagster.models import Location
from meteo_dagster.resources import (
    MeteoConfigResource,
    OpenMeteoResource,
    WarehouseResource,
)
from meteo_dagster.schemas import parse_forecast
from meteo_dagster.transform import transform_forecast


@pytest.fixture
def resources(tmp_path: Path) -> dict:
    return {
        "open_meteo": OpenMeteoResource(),
        "meteo_config": MeteoConfigResource(raw_dir=str(tmp_path / "raw")),
        "warehouse": WarehouseResource(path=str(tmp_path / "warehouse.sqlite")),
    }


def test_forecast_job_materializes_snapshot_and_passes_check(
    resources: dict, forecast_payload: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        OpenMeteoResource,
        "fetch_forecast",
        lambda self, latitude, longitude, forecast_days: forecast_payload,
    )

    result = materialize(
        [forecast_raw, forecast_snapshot, forecast_quality],
        resources=resources,
        raise_on_error=True,
    )

    assert result.success
    checks = result.get_asset_check_evaluations()
    assert len(checks) == 1
    assert checks[0].passed is True

    warehouse: WarehouseResource = resources["warehouse"]
    quality = warehouse.latest_quality(Location(-18.8792, 47.5079), "forecast")
    assert quality is not None
    assert quality.observation_count == 24


def test_forecast_asset_check_fails_without_temperature(
    resources: dict, forecast_payload: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    forecast_payload["current"]["temperature_2m"] = None
    forecast_payload["hourly"]["temperature_2m"] = [None, None]
    monkeypatch.setattr(
        OpenMeteoResource,
        "fetch_forecast",
        lambda self, latitude, longitude, forecast_days: forecast_payload,
    )

    result = materialize(
        [forecast_raw, forecast_snapshot, forecast_quality],
        resources=resources,
        raise_on_error=True,
    )

    checks = result.get_asset_check_evaluations()
    assert len(checks) == 1
    assert checks[0].passed is False


def test_archive_partition_materializes_and_passes_check(
    resources: dict, archive_payload: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        OpenMeteoResource,
        "fetch_archive",
        lambda self, latitude, longitude, start_date, end_date: archive_payload,
    )

    result = materialize(
        [archive_raw, archive_snapshot, archive_quality],
        partition_key="2025-01-15",
        resources=resources,
        raise_on_error=True,
    )

    assert result.success
    checks = result.get_asset_check_evaluations()
    assert len(checks) == 1
    assert checks[0].passed is True

    warehouse: WarehouseResource = resources["warehouse"]
    stats = warehouse.partition_stats("2025-01-15")
    assert stats.snapshot_count == 1
    assert stats.observation_count == 4


def test_retention_purges_old_forecasts(
    resources: dict, forecast_payload: dict
) -> None:
    warehouse: WarehouseResource = resources["warehouse"]
    snapshot = transform_forecast(parse_forecast(forecast_payload), forecast_days=7)
    warehouse.save_snapshot(
        Location(-18.8792, 47.5079),
        snapshot,
        fetched_at=datetime.now(timezone.utc) - timedelta(days=130),
        asset="forecast_snapshot",
    )

    result = materialize([retention], resources=resources, raise_on_error=True)

    assert result.success
    materialization = result.asset_materializations_for_node("retention")[0]
    assert materialization.metadata["supprimes"].value == 1
    assert warehouse.latest_quality(Location(-18.8792, 47.5079), "forecast") is None
