"""Assets Dagster du pipeline Météo.

Architecture en deux couches :

- **bronze** (`forecast_raw`, `archive_raw`) : réponse Open-Meteo conservée
  telle que reçue, compressée sur disque, avant toute validation ;
- **silver** (`forecast_snapshot`, `archive_snapshot`) : validation Pydantic,
  transformation en format long et écriture dans l'entrepôt SQLite.

L'archive ERA5 est partitionnée par jour. Une partition est immuable : la
relancer avec le même contenu ne crée pas de nouveau snapshot (empreinte
SHA-256). La rétention purge les snapshots de prévision trop anciens.
"""

from datetime import datetime, timedelta, timezone

from dagster import (
    AssetCheckExecutionContext,
    AssetCheckResult,
    AssetExecutionContext,
    DailyPartitionsDefinition,
    MaterializeResult,
    MetadataValue,
    asset,
    asset_check,
)

from .models import RawDocument
from .resources import (
    MeteoConfigResource,
    OpenMeteoResource,
    WarehouseResource,
)
from .schemas import parse_archive, parse_forecast
from .storage import persist_raw_document, purge_raw_forecasts
from .transform import transform_archive, transform_forecast

# ERA5 est publiée avec ~6 jours de retard ; la partition la plus récente
# disponible est donc celle d'il y a 6 jours.
ERA5_SAFETY_DAYS = 6

archive_partitions = DailyPartitionsDefinition(
    start_date="2024-01-01",
    end_offset=-ERA5_SAFETY_DAYS,
)


def _utc_now(context: AssetExecutionContext) -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


@asset(
    group_name="bronze",
    compute_kind="open-meteo",
    description=(
        "Réponses de prévision Open-Meteo conservées telles que reçues "
        "(JSON compressé sur disque) pour toutes les localisations configurées."
    ),
)
def forecast_raw(
    context: AssetExecutionContext,
    open_meteo: OpenMeteoResource,
    meteo_config: MeteoConfigResource,
) -> RawDocument:
    fetched_at = _utc_now(context)
    locations = meteo_config.location_list()
    payloads = {
        location.key: open_meteo.fetch_forecast(
            location.latitude,
            location.longitude,
            meteo_config.forecast_days,
        )
        for location in locations
    }
    document = persist_raw_document(
        raw_dir=meteo_config.raw_dir,
        kind="forecast",
        fetched_at=fetched_at,
        locations=locations,
        forecast_days=meteo_config.forecast_days,
        partition_key=None,
        payloads=payloads,
    )
    context.add_output_metadata(
        {
            "chemin": MetadataValue.path(document.path),
            "localisations": len(locations),
            "collecte_utc": fetched_at.isoformat(),
        }
    )
    return document


@asset(
    group_name="silver",
    compute_kind="python",
    description=(
        "Prévisions validées et normalisées en observations longues, stockées "
        "en snapshots immuables dans SQLite."
    ),
)
def forecast_snapshot(
    context: AssetExecutionContext,
    forecast_raw: RawDocument,
    warehouse: WarehouseResource,
) -> MaterializeResult:
    inserted = 0
    rows_total = 0

    for location in forecast_raw.locations:
        payload = parse_forecast(forecast_raw.payloads[location.key])
        snapshot = transform_forecast(payload, forecast_raw.forecast_days or 7)
        result = warehouse.save_snapshot(
            location,
            snapshot,
            fetched_at=forecast_raw.fetched_at,
            asset="forecast_snapshot",
            dagster_run_id=context.run.run_id,
        )
        rows_total += result.observation_count
        inserted += int(result.inserted)
        context.log.info(
            "prévision %s,%s : %s (%d lignes)",
            location.latitude,
            location.longitude,
            "insérée" if result.inserted else "inchangée",
            result.observation_count,
        )

    return MaterializeResult(
        metadata={
            "localisations": len(forecast_raw.locations),
            "snapshots_inseres": inserted,
            "snapshots_ignores": len(forecast_raw.locations) - inserted,
            "observations": rows_total,
            "brut": MetadataValue.path(forecast_raw.path),
        }
    )


@asset(
    group_name="bronze",
    compute_kind="open-meteo",
    partitions_def=archive_partitions,
    description=(
        "Réponses ERA5 d'une journée, conservées telles que reçues. "
        "Une partition par date couverte."
    ),
)
def archive_raw(
    context: AssetExecutionContext,
    open_meteo: OpenMeteoResource,
    meteo_config: MeteoConfigResource,
) -> RawDocument:
    partition_key = context.partition_key
    fetched_at = _utc_now(context)
    locations = meteo_config.location_list()
    payloads = {
        location.key: open_meteo.fetch_archive(
            location.latitude,
            location.longitude,
            partition_key,
            partition_key,
        )
        for location in locations
    }
    document = persist_raw_document(
        raw_dir=meteo_config.raw_dir,
        kind="archive",
        fetched_at=fetched_at,
        locations=locations,
        forecast_days=None,
        partition_key=partition_key,
        payloads=payloads,
    )
    context.add_output_metadata(
        {
            "chemin": MetadataValue.path(document.path),
            "partition": partition_key,
            "localisations": len(locations),
        }
    )
    return document


@asset(
    group_name="silver",
    compute_kind="python",
    partitions_def=archive_partitions,
    description=(
        "Archive ERA5 journalière validée et normalisée, stockée en snapshot "
        "immuable par localisation et par partition."
    ),
)
def archive_snapshot(
    context: AssetExecutionContext,
    archive_raw: RawDocument,
    warehouse: WarehouseResource,
) -> MaterializeResult:
    inserted = 0
    rows_total = 0

    for location in archive_raw.locations:
        payload = parse_archive(archive_raw.payloads[location.key])
        snapshot = transform_archive(payload)
        result = warehouse.save_snapshot(
            location,
            snapshot,
            fetched_at=archive_raw.fetched_at,
            asset="archive_snapshot",
            dagster_run_id=context.run.run_id,
            partition_key=archive_raw.partition_key,
        )
        rows_total += result.observation_count
        inserted += int(result.inserted)

    return MaterializeResult(
        metadata={
            "partition": archive_raw.partition_key,
            "localisations": len(archive_raw.locations),
            "snapshots_inseres": inserted,
            "snapshots_ignores": len(archive_raw.locations) - inserted,
            "observations": rows_total,
            "brut": MetadataValue.path(archive_raw.path),
        }
    )


@asset(
    group_name="maintenance",
    compute_kind="sqlite",
    description=(
        "Purge des snapshots de prévision et des documents bruts plus anciens "
        "que la rétention configurée."
    ),
)
def retention(
    context: AssetExecutionContext,
    warehouse: WarehouseResource,
    meteo_config: MeteoConfigResource,
) -> MaterializeResult:
    if meteo_config.retention_days <= 0:
        context.log.info("rétention désactivée (ETL_RETENTION_DAYS=0)")
        return MaterializeResult(metadata={"supprimes": 0, "desactivee": True})

    cutoff = datetime.now(timezone.utc) - timedelta(days=meteo_config.retention_days)
    cutoff = cutoff.replace(microsecond=0)
    deleted = warehouse.purge_forecast_snapshots_before(cutoff.isoformat())
    raw_deleted = purge_raw_forecasts(meteo_config.raw_dir, cutoff)
    context.log.info(
        "rétention : %d snapshot(s) et %d fichier(s) brut(s) supprimé(s) avant %s",
        deleted,
        raw_deleted,
        cutoff.isoformat(),
    )
    return MaterializeResult(
        metadata={
            "supprimes": deleted,
            "fichiers_bruts_supprimes": raw_deleted,
            "date_limite": cutoff.isoformat(),
            "desactivee": False,
        }
    )


@asset_check(asset=forecast_snapshot, blocking=False)
def forecast_quality(
    warehouse: WarehouseResource,
    meteo_config: MeteoConfigResource,
) -> AssetCheckResult:
    """Le dernier snapshot de prévision contient-il des températures réelles ?"""
    details: dict[str, object] = {}
    passed = True

    for location in meteo_config.location_list():
        quality = warehouse.latest_quality(location, "forecast")
        if quality is None:
            passed = False
            details[location.key] = {"snapshot": None}
            continue
        location_passed = quality.temperature_non_null > 0
        passed = passed and location_passed
        details[location.key] = {
            "snapshot_id": quality.snapshot_id,
            "observations": quality.observation_count,
            "temperature_non_null": quality.temperature_non_null,
            "conforme": location_passed,
        }

    return AssetCheckResult(
        passed=passed,
        metadata={"localisations": MetadataValue.json(details)},
        description=(
            "Au moins une valeur de température non nulle dans le dernier "
            "snapshot de prévision de chaque localisation."
        ),
    )


@asset_check(asset=archive_snapshot, blocking=False)
def archive_quality(
    context: AssetCheckExecutionContext,
    warehouse: WarehouseResource,
) -> AssetCheckResult:
    """La partition ERA5 matérialisée est-elle réellement chargée ?"""
    partition_key = context.partition_key
    stats = warehouse.partition_stats(partition_key)
    passed = stats.snapshot_count > 0 and stats.observation_count > 0
    return AssetCheckResult(
        passed=passed,
        metadata={
            "partition": partition_key,
            "snapshots": stats.snapshot_count,
            "observations": stats.observation_count,
            "localisations": stats.locations,
        },
        description="La partition ERA5 contient au moins un snapshot non vide.",
    )
