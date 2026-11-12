"""Transformation vers le format long : valeurs nulles, déduplication, empreinte."""

from __future__ import annotations

from meteo_dagster.schemas import parse_archive, parse_forecast
from meteo_dagster.transform import transform_archive, transform_forecast


def _by_key(snapshot, granularity: str, valid_time: str, variable: str):
    for row in snapshot.observations:
        if (row.granularity, row.valid_time, row.variable) == (
            granularity,
            valid_time,
            variable,
        ):
            return row
    raise AssertionError(f"observation absente : {granularity}/{valid_time}/{variable}")


def test_transform_forecast_produces_long_format(forecast_payload: dict) -> None:
    snapshot = transform_forecast(parse_forecast(forecast_payload), forecast_days=7)

    assert snapshot.kind == "forecast"
    assert snapshot.model is None
    assert snapshot.forecast_days == 7
    assert snapshot.timezone == "Indian/Antananarivo"
    # 6 variables courantes + 2 heures × 5 + 2 jours × 4
    assert len(snapshot.observations) == 6 + 10 + 8
    assert len(snapshot.content_hash) == 64

    current = _by_key(snapshot, "current", "2025-01-15T10:00", "temperature_2m")
    assert current.value == 26.4
    assert current.unit == "°C"


def test_transform_preserves_missing_value_as_none(forecast_payload: dict) -> None:
    snapshot = transform_forecast(parse_forecast(forecast_payload), forecast_days=7)
    row = _by_key(snapshot, "hourly", "2025-01-15T10:00", "temperature_2m")
    assert row.value is None


def test_transform_does_not_let_null_overwrite_real_value(forecast_payload: dict) -> None:
    forecast_payload["hourly"]["time"] = ["2025-01-15T09:00", "2025-01-15T09:00"]
    forecast_payload["hourly"]["temperature_2m"] = [25.1, None]
    snapshot = transform_forecast(parse_forecast(forecast_payload), forecast_days=7)

    row = _by_key(snapshot, "hourly", "2025-01-15T09:00", "temperature_2m")
    assert row.value == 25.1


def test_transform_hash_is_stable_and_ignores_collection_time(forecast_payload: dict) -> None:
    first = transform_forecast(parse_forecast(forecast_payload), forecast_days=7)
    second = transform_forecast(parse_forecast(forecast_payload), forecast_days=7)
    assert first.content_hash == second.content_hash

    other_horizon = transform_forecast(parse_forecast(forecast_payload), forecast_days=10)
    assert other_horizon.content_hash != first.content_hash


def test_transform_archive_is_daily_era5(archive_payload: dict) -> None:
    snapshot = transform_archive(parse_archive(archive_payload))

    assert snapshot.kind == "archive"
    assert snapshot.model == "era5"
    assert snapshot.forecast_days is None
    assert len(snapshot.observations) == 4
    assert _by_key(snapshot, "daily", "2025-01-15", "precipitation_sum").value == 0.2
