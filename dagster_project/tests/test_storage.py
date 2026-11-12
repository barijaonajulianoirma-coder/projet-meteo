"""Zone brute : écriture atomique et relecture."""

from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from meteo_dagster.models import Location
from meteo_dagster.storage import persist_raw_document, read_raw_document


def test_persist_and_read_roundtrip(tmp_path: Path, forecast_payload: dict) -> None:
    fetched_at = datetime(2025, 1, 15, 10, 0, tzinfo=timezone.utc)
    locations = (Location(-18.8792, 47.5079, "Antananarivo"),)

    document = persist_raw_document(
        raw_dir=str(tmp_path / "raw"),
        kind="forecast",
        fetched_at=fetched_at,
        locations=locations,
        forecast_days=7,
        partition_key=None,
        payloads={locations[0].key: forecast_payload},
    )

    path = Path(document.path)
    assert path.exists()
    assert path.suffix == ".gz"
    assert not path.with_name(f".{path.name}.tmp").exists()

    restored = read_raw_document(document.path)
    assert restored.kind == "forecast"
    assert restored.fetched_at == fetched_at
    assert restored.forecast_days == 7
    assert restored.locations == locations
    assert restored.payloads[locations[0].key] == forecast_payload


def test_archive_document_is_partitioned(tmp_path: Path, archive_payload: dict) -> None:
    document = persist_raw_document(
        raw_dir=str(tmp_path / "raw"),
        kind="archive",
        fetched_at=datetime(2025, 1, 22, 6, 0, tzinfo=timezone.utc),
        locations=(Location(-18.8792, 47.5079),),
        forecast_days=None,
        partition_key="2025-01-15",
        payloads={"x": archive_payload},
    )

    assert "date=2025-01-15" in Path(document.path).parts


def test_read_rejects_unknown_format_version(tmp_path: Path, forecast_payload: dict) -> None:
    path = tmp_path / "raw" / "forecast" / "doc.json.gz"
    path.parent.mkdir(parents=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump({"format_version": 99}, handle)

    with pytest.raises(ValueError, match="Version de format"):
        read_raw_document(str(path))
