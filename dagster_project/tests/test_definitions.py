"""Câblage Dagster : assets, contrôles, jobs, planifications."""

from __future__ import annotations

from datetime import datetime, timezone

from meteo_dagster.definitions import archive_partition_key, defs


def test_definitions_expose_expected_graph() -> None:
    graph = defs.resolve_asset_graph()

    assert {key.to_user_string() for key in graph.get_all_asset_keys()} == {
        "archive_raw",
        "archive_snapshot",
        "forecast_raw",
        "forecast_snapshot",
        "retention",
    }
    assert {check.name for check in graph.asset_check_keys} == {
        "archive_quality",
        "forecast_quality",
    }
    assert {job.name for job in defs.jobs} == {
        "archive_job",
        "forecast_job",
        "maintenance_job",
    }
    assert {schedule.name for schedule in defs.schedules} == {
        "archive_daily",
        "forecast_hourly",
        "retention_daily",
    }


def test_archive_partition_is_safety_shifted() -> None:
    scheduled = datetime(2025, 1, 21, 6, 0, tzinfo=timezone.utc)
    assert archive_partition_key(scheduled) == "2025-01-15"
