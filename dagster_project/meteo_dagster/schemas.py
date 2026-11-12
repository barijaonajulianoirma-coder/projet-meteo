"""Validation des réponses brutes Open-Meteo.

La couche bronze conserve le JSON tel que reçu ; ce module est la frontière de
validation avant toute transformation. Une réponse non conforme lève
`MeteoDataError` et fait échouer l'asset sans écrire de données partielles.
"""

from __future__ import annotations

from typing import Iterable

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class MeteoDataError(ValueError):
    """Réponse Open-Meteo inexploitable."""


class _ApiModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class CurrentConditions(_ApiModel):
    time: str
    interval: int = 0
    temperature_2m: float | None = None
    apparent_temperature: float | None = None
    relative_humidity_2m: float | None = None
    precipitation: float | None = None
    weather_code: float | None = None
    wind_speed_10m: float | None = None


class HourlySeries(_ApiModel):
    time: list[str]
    temperature_2m: list[float | None] = Field(default_factory=list)
    relative_humidity_2m: list[float | None] = Field(default_factory=list)
    precipitation_probability: list[float | None] = Field(default_factory=list)
    precipitation: list[float | None] = Field(default_factory=list)
    wind_speed_10m: list[float | None] = Field(default_factory=list)


class DailySeries(_ApiModel):
    time: list[str]
    temperature_2m_mean: list[float | None] = Field(default_factory=list)
    temperature_2m_max: list[float | None] = Field(default_factory=list)
    temperature_2m_min: list[float | None] = Field(default_factory=list)
    precipitation_sum: list[float | None] = Field(default_factory=list)


class ForecastResponse(_ApiModel):
    latitude: float
    longitude: float
    timezone: str
    timezone_abbreviation: str = ""
    utc_offset_seconds: int
    current_units: dict[str, str] = Field(default_factory=dict)
    current: CurrentConditions | None = None
    hourly_units: dict[str, str] = Field(default_factory=dict)
    hourly: HourlySeries
    daily_units: dict[str, str] = Field(default_factory=dict)
    daily: DailySeries


class ArchiveResponse(_ApiModel):
    latitude: float
    longitude: float
    timezone: str
    timezone_abbreviation: str = ""
    utc_offset_seconds: int
    daily_units: dict[str, str] = Field(default_factory=dict)
    daily: DailySeries
    error: bool | None = None
    reason: str | None = None


def assert_aligned(time: Iterable[str], series: dict[str, list[object]]) -> None:
    """Vérifie que chaque série a exactement la longueur de l'axe temporel."""
    length = len(list(time))
    for name, values in series.items():
        if len(values) != length:
            raise MeteoDataError(
                f"Série « {name} » de longueur {len(values)} alors que {length} dates sont attendues"
            )


def parse_forecast(raw: object) -> ForecastResponse:
    try:
        payload = ForecastResponse.model_validate(raw)
    except ValidationError as exc:
        raise MeteoDataError(f"Structure de prévision non conforme : {exc.error_count()} erreur(s)") from exc

    assert_aligned(
        payload.hourly.time,
        {
            "temperature_2m": payload.hourly.temperature_2m,
            "relative_humidity_2m": payload.hourly.relative_humidity_2m,
            "precipitation_probability": payload.hourly.precipitation_probability,
            "precipitation": payload.hourly.precipitation,
            "wind_speed_10m": payload.hourly.wind_speed_10m,
        },
    )
    assert_aligned(
        payload.daily.time,
        {
            "temperature_2m_mean": payload.daily.temperature_2m_mean,
            "temperature_2m_max": payload.daily.temperature_2m_max,
            "temperature_2m_min": payload.daily.temperature_2m_min,
            "precipitation_sum": payload.daily.precipitation_sum,
        },
    )
    return payload


def parse_archive(raw: object) -> ArchiveResponse:
    try:
        payload = ArchiveResponse.model_validate(raw)
    except ValidationError as exc:
        raise MeteoDataError(f"Structure ERA5 non conforme : {exc.error_count()} erreur(s)") from exc

    if payload.error is True:
        raise MeteoDataError(payload.reason or "Erreur signalée par l'API d'archive")

    assert_aligned(
        payload.daily.time,
        {
            "temperature_2m_mean": payload.daily.temperature_2m_mean,
            "temperature_2m_max": payload.daily.temperature_2m_max,
            "temperature_2m_min": payload.daily.temperature_2m_min,
            "precipitation_sum": payload.daily.precipitation_sum,
        },
    )
    return payload
