"""Validation des réponses Open-Meteo."""

from __future__ import annotations

import pytest

from meteo_dagster.schemas import (
    MeteoDataError,
    parse_archive,
    parse_forecast,
)


def test_parse_forecast_accepts_nominal_payload(forecast_payload: dict) -> None:
    parsed = parse_forecast(forecast_payload)
    assert parsed.current is not None
    assert parsed.current.temperature_2m == 26.4
    assert parsed.current_units["temperature_2m"] == "°C"
    assert len(parsed.hourly.time) == 2


def test_parse_forecast_rejects_misaligned_series(forecast_payload: dict) -> None:
    forecast_payload["hourly"]["wind_speed_10m"] = [8.3]
    with pytest.raises(MeteoDataError, match="wind_speed_10m"):
        parse_forecast(forecast_payload)


def test_parse_forecast_rejects_missing_daily_block(forecast_payload: dict) -> None:
    del forecast_payload["daily"]
    with pytest.raises(MeteoDataError, match="non conforme"):
        parse_forecast(forecast_payload)


def test_parse_archive_accepts_nominal_payload(archive_payload: dict) -> None:
    parsed = parse_archive(archive_payload)
    assert parsed.daily.time == ["2025-01-15"]


def test_parse_archive_rejects_api_error(archive_payload: dict) -> None:
    archive_payload["error"] = True
    archive_payload["reason"] = "Quota dépassé"
    with pytest.raises(MeteoDataError, match="Quota dépassé"):
        parse_archive(archive_payload)
