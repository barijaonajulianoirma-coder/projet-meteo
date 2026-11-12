"""Fixtures de test : payloads Open-Meteo simulés, aucun appel réseau."""

from __future__ import annotations

import copy
from datetime import datetime, timezone

import pytest

FORECAST_PAYLOAD = {
    "latitude": -18.8792,
    "longitude": 47.5079,
    "timezone": "Indian/Antananarivo",
    "timezone_abbreviation": "EAT",
    "utc_offset_seconds": 10800,
    "current_units": {
        "temperature_2m": "°C",
        "relative_humidity_2m": "%",
        "apparent_temperature": "°C",
        "precipitation": "mm",
        "weather_code": "wmo code",
        "wind_speed_10m": "km/h",
    },
    "current": {
        "time": "2025-01-15T10:00",
        "interval": 900,
        "temperature_2m": 26.4,
        "relative_humidity_2m": 71,
        "apparent_temperature": 28.1,
        "precipitation": 0.0,
        "weather_code": 2,
        "wind_speed_10m": 12.6,
    },
    "hourly_units": {
        "temperature_2m": "°C",
        "relative_humidity_2m": "%",
        "precipitation_probability": "%",
        "precipitation": "mm",
        "wind_speed_10m": "km/h",
    },
    "hourly": {
        "time": ["2025-01-15T09:00", "2025-01-15T10:00"],
        "temperature_2m": [25.1, None],
        "relative_humidity_2m": [78, 71],
        "precipitation_probability": [10, 20],
        "precipitation": [0.0, 0.2],
        "wind_speed_10m": [8.3, 12.6],
    },
    "daily_units": {
        "temperature_2m_mean": "°C",
        "temperature_2m_max": "°C",
        "temperature_2m_min": "°C",
        "precipitation_sum": "mm",
    },
    "daily": {
        "time": ["2025-01-15", "2025-01-16"],
        "temperature_2m_mean": [24.2, 23.8],
        "temperature_2m_max": [29.1, 28.4],
        "temperature_2m_min": [19.0, 18.6],
        "precipitation_sum": [0.2, 4.1],
    },
}

ARCHIVE_PAYLOAD = {
    "latitude": -18.8792,
    "longitude": 47.5079,
    "timezone": "Indian/Antananarivo",
    "timezone_abbreviation": "EAT",
    "utc_offset_seconds": 10800,
    "daily_units": {
        "temperature_2m_mean": "°C",
        "temperature_2m_max": "°C",
        "temperature_2m_min": "°C",
        "precipitation_sum": "mm",
    },
    "daily": {
        "time": ["2025-01-15"],
        "temperature_2m_mean": [24.2],
        "temperature_2m_max": [29.1],
        "temperature_2m_min": [19.0],
        "precipitation_sum": [0.2],
    },
}


@pytest.fixture
def forecast_payload() -> dict:
    """Copie profonde : chaque test peut la modifier sans effet de bord."""
    return copy.deepcopy(FORECAST_PAYLOAD)


@pytest.fixture
def archive_payload() -> dict:
    return copy.deepcopy(ARCHIVE_PAYLOAD)


@pytest.fixture
def fixed_now() -> datetime:
    return datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc)
