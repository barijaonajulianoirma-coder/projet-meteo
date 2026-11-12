"""Transformation des réponses Open-Meteo validées vers le format long.

Règles identiques au reste du projet :
- une valeur absente reste `None`, jamais 0 ;
- déduplication par (granularité, valid_time, variable), sans écraser une
  valeur réelle par `None` ;
- l'empreinte SHA-256 du contenu exclut l'heure de collecte.
"""

from __future__ import annotations

import hashlib
import json
from typing import Iterable

from .models import Observation, TransformedSnapshot
from .schemas import ArchiveResponse, ForecastResponse

FORECAST_SOURCE = "open-meteo:forecast"
ARCHIVE_SOURCE = "open-meteo:archive-era5"

HOURLY_VARIABLES = (
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

CURRENT_VARIABLES = (
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
)


def _value(value: float | None) -> float | None:
    return None if value is None else float(value)


def _unit(units: dict[str, str], variable: str) -> str | None:
    unit = units.get(variable)
    return unit if unit and unit.strip() else None


def _dedupe(rows: Iterable[Observation]) -> tuple[Observation, ...]:
    by_key: dict[tuple[str, str, str], Observation] = {}
    for row in rows:
        key = (row.granularity, row.valid_time, row.variable)
        existing = by_key.get(key)
        if existing is not None and existing.value is not None and row.value is None:
            continue
        by_key[key] = row
    return tuple(by_key.values())


def _hash(kind: str, forecast_days: int | None, observations: Iterable[Observation]) -> str:
    canonical = {
        "kind": kind,
        "forecast_days": forecast_days,
        "observations": [
            [row.granularity, row.valid_time, row.variable, row.value, row.unit]
            for row in observations
        ],
    }
    encoded = json.dumps(canonical, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def transform_forecast(payload: ForecastResponse, forecast_days: int) -> TransformedSnapshot:
    rows: list[Observation] = []

    if payload.current is not None:
        current = payload.current
        for variable in CURRENT_VARIABLES:
            rows.append(
                Observation(
                    granularity="current",
                    valid_time=current.time,
                    variable=variable,
                    value=_value(getattr(current, variable)),
                    unit=_unit(payload.current_units, variable),
                )
            )

    hourly_series = {
        variable: getattr(payload.hourly, variable) for variable in HOURLY_VARIABLES
    }
    for index, valid_time in enumerate(payload.hourly.time):
        for variable, values in hourly_series.items():
            rows.append(
                Observation(
                    granularity="hourly",
                    valid_time=valid_time,
                    variable=variable,
                    value=_value(values[index] if index < len(values) else None),
                    unit=_unit(payload.hourly_units, variable),
                )
            )

    daily_series = {
        variable: getattr(payload.daily, variable) for variable in DAILY_VARIABLES
    }
    for index, valid_date in enumerate(payload.daily.time):
        for variable, values in daily_series.items():
            rows.append(
                Observation(
                    granularity="daily",
                    valid_time=valid_date,
                    variable=variable,
                    value=_value(values[index] if index < len(values) else None),
                    unit=_unit(payload.daily_units, variable),
                )
            )

    observations = _dedupe(rows)
    return TransformedSnapshot(
        kind="forecast",
        source=FORECAST_SOURCE,
        model=None,
        timezone=payload.timezone,
        timezone_abbreviation=payload.timezone_abbreviation,
        utc_offset_seconds=payload.utc_offset_seconds,
        forecast_days=forecast_days,
        observations=observations,
        content_hash=_hash("forecast", forecast_days, observations),
    )


def transform_archive(payload: ArchiveResponse) -> TransformedSnapshot:
    rows: list[Observation] = []
    daily_series = {
        variable: getattr(payload.daily, variable) for variable in DAILY_VARIABLES
    }
    for index, valid_date in enumerate(payload.daily.time):
        for variable, values in daily_series.items():
            rows.append(
                Observation(
                    granularity="daily",
                    valid_time=valid_date,
                    variable=variable,
                    value=_value(values[index] if index < len(values) else None),
                    unit=_unit(payload.daily_units, variable),
                )
            )

    observations = _dedupe(rows)
    return TransformedSnapshot(
        kind="archive",
        source=ARCHIVE_SOURCE,
        model="era5",
        timezone=payload.timezone,
        timezone_abbreviation=payload.timezone_abbreviation,
        utc_offset_seconds=payload.utc_offset_seconds,
        forecast_days=None,
        observations=observations,
        content_hash=_hash("archive", None, observations),
    )
