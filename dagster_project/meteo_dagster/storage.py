"""Zone brute (bronze) : payloads JSON compressés, horodatés et immuables.

Le document est écrit de façon atomique (fichier temporaire puis `os.replace`)
pour qu'une interruption ne laisse jamais un JSON tronqué.
"""

from __future__ import annotations

import gzip
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from .models import Location, RawDocument, SnapshotKind

FORMAT_VERSION = 1


def _timestamp(fetched_at: datetime) -> str:
    return fetched_at.strftime("%Y%m%dT%H%M%S%fZ")


def _target_path(
    raw_dir: str,
    kind: SnapshotKind,
    fetched_at: datetime,
    partition_key: str | None,
) -> Path:
    root = Path(raw_dir) / kind
    if partition_key:
        root = root / f"date={partition_key}"
    return root / f"{kind}_{_timestamp(fetched_at)}.json.gz"


def persist_raw_document(
    *,
    raw_dir: str,
    kind: SnapshotKind,
    fetched_at: datetime,
    locations: Sequence[Location],
    forecast_days: int | None,
    partition_key: str | None,
    payloads: dict[str, dict[str, Any]],
) -> RawDocument:
    path = _target_path(raw_dir, kind, fetched_at, partition_key)
    path.parent.mkdir(parents=True, exist_ok=True)

    body = {
        "format_version": FORMAT_VERSION,
        "kind": kind,
        "fetched_at": fetched_at.isoformat(),
        "forecast_days": forecast_days,
        "partition_key": partition_key,
        "locations": [
            {"latitude": location.latitude, "longitude": location.longitude, "label": location.label}
            for location in locations
        ],
        "payloads": payloads,
    }

    temporary = path.with_name(f".{path.name}.tmp")
    try:
        with gzip.open(temporary, "wt", encoding="utf-8") as handle:
            json.dump(body, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)

    return RawDocument(
        path=str(path),
        kind=kind,
        fetched_at=fetched_at,
        locations=tuple(locations),
        forecast_days=forecast_days,
        partition_key=partition_key,
        payloads=payloads,
    )


def purge_raw_forecasts(raw_dir: str, cutoff: datetime) -> int:
    """Supprime les documents bruts de prévision collectés avant `cutoff`.

    L'horodatage est lu dans le nom de fichier (et non dans le mtime), afin
    qu'une copie ou une sauvegarde ne réinitialise pas l'âge d'un document.
    Les archives ERA5 ne sont jamais purgées.
    """
    root = Path(raw_dir) / "forecast"
    if not root.is_dir():
        return 0

    removed = 0
    for path in root.glob("forecast_*.json.gz"):
        match = re.fullmatch(r"forecast_(\d{8}T\d{12})Z\.json\.gz", path.name)
        if match is None:
            continue
        fetched_at = datetime.strptime(match.group(1), "%Y%m%dT%H%M%S%f").replace(
            tzinfo=timezone.utc
        )
        if fetched_at < cutoff:
            try:
                path.unlink()
                removed += 1
            except FileNotFoundError:  # pragma: no cover - suppression concurrente
                continue
    return removed


def read_raw_document(path: str) -> RawDocument:
    """Relit un document brut (rejeu ou audit), avec vérification de version."""
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        body = json.load(handle)

    if body.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"Version de format brut non prise en charge : {body.get('format_version')}")

    return RawDocument(
        path=path,
        kind=body["kind"],
        fetched_at=datetime.fromisoformat(body["fetched_at"]),
        locations=tuple(
            Location(
                latitude=float(location["latitude"]),
                longitude=float(location["longitude"]),
                label=location.get("label"),
            )
            for location in body["locations"]
        ),
        forecast_days=body.get("forecast_days"),
        partition_key=body.get("partition_key"),
        payloads=body["payloads"],
    )
