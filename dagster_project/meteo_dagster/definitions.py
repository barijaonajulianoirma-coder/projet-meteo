"""Point d'entrée Dagster (référencé par `[tool.dagster]` de pyproject.toml).

Lancement local :

    dagster dev -m meteo_dagster.definitions

Journaux de planification par défaut (UTC) :

- prévisions : toutes les heures à H:05 ;
- archive ERA5 : tous les jours à 06:00, partition J−6 ;
- rétention : tous les jours à 04:00.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from dagster import (
    AssetSelection,
    Definitions,
    RunRequest,
    ScheduleDefinition,
    define_asset_job,
    schedule,
)

from .assets import (
    ERA5_SAFETY_DAYS,
    archive_quality,
    archive_raw,
    archive_snapshot,
    forecast_quality,
    forecast_raw,
    forecast_snapshot,
    retention,
)
from .resources import MeteoConfigResource, OpenMeteoResource, WarehouseResource

forecast_job = define_asset_job(
    name="forecast_job",
    description="Collecte horaire des prévisions et contrôle qualité.",
    selection=(
        AssetSelection.assets(forecast_raw, forecast_snapshot)
        | AssetSelection.checks(forecast_quality)
    ),
)

archive_job = define_asset_job(
    name="archive_job",
    description="Collecte ERA5 d'une journée (partition) et contrôle qualité.",
    selection=(
        AssetSelection.assets(archive_raw, archive_snapshot)
        | AssetSelection.checks(archive_quality)
    ),
)

maintenance_job = define_asset_job(
    name="maintenance_job",
    description="Purge des snapshots de prévision au-delà de la rétention.",
    selection=AssetSelection.assets(retention),
)

forecast_schedule = ScheduleDefinition(
    name="forecast_hourly",
    job=forecast_job,
    cron_schedule="5 * * * *",
    execution_timezone="UTC",
    description="Prévisions toutes les heures (minute 5).",
)

def archive_partition_key(scheduled: datetime) -> str:
    """Partition ERA5 à matérialiser pour une exécution planifiée donnée."""
    return (scheduled - timedelta(days=ERA5_SAFETY_DAYS)).date().isoformat()


# L'asset archive est partitionné avec un décalage de 6 jours : le planificateur
# générique choisirait une partition future. On cible donc explicitement J−6.
@schedule(
    name="archive_daily",
    job=archive_job,
    cron_schedule="0 6 * * *",
    execution_timezone="UTC",
    description="Archive ERA5 du jour disponible (J−6), chaque matin.",
)
def archive_daily_schedule(context) -> RunRequest:
    scheduled = context.scheduled_execution_time
    if scheduled is None:  # pragma: no cover - toujours fourni par le daemon
        raise RuntimeError("Heure planifiée indisponible")
    partition_key = archive_partition_key(scheduled)
    context.log.info("archive ERA5 demandée pour la partition %s", partition_key)
    return RunRequest(partition_key=partition_key)


retention_schedule = ScheduleDefinition(
    name="retention_daily",
    job=maintenance_job,
    cron_schedule="0 4 * * *",
    execution_timezone="UTC",
    description="Purge quotidienne des snapshots de prévision expirés.",
)

defs = Definitions(
    assets=[forecast_raw, forecast_snapshot, archive_raw, archive_snapshot, retention],
    asset_checks=[forecast_quality, archive_quality],
    jobs=[forecast_job, archive_job, maintenance_job],
    schedules=[
        forecast_schedule,
        archive_daily_schedule,
        retention_schedule,
    ],
    resources={
        "open_meteo": OpenMeteoResource(),
        "meteo_config": MeteoConfigResource(),
        "warehouse": WarehouseResource(),
    },
)
