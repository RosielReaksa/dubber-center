"""Scheduled maintenance: stale file cleanup, health rows, stats rollups."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, select

from dubber_center.config import settings
from dubber_center.core.logging import get_logger
from dubber_center.db.base import SessionLocal, utcnow
from dubber_center.db.tables import File, ModelHealth
from dubber_center.services.storage import get_storage

log = get_logger("dubber_center.maintenance")


async def cleanup_expired_files(dry_run: bool = False) -> dict:
    """Delete input/output files past their retention window."""
    cutoff = utcnow() - timedelta(days=settings.file_retention_days)
    removed = 0
    failed = 0

    async with SessionLocal() as session:
        rows = (
            await session.scalars(select(File).where(File.created_at < cutoff))
        ).all()
        storage = get_storage()
        for row in rows:
            if dry_run:
                removed += 1
                continue
            try:
                await storage.delete(row.storage_key)
            except Exception:  # a missing object is not an error
                failed += 1
            await session.delete(row)
            removed += 1
        if not dry_run:
            await session.commit()

    log.info("file cleanup", extra={"removed": removed, "failed": failed, "dry_run": dry_run})
    return {"removed": removed, "failed": failed, "dry_run": dry_run}


async def cleanup_health_rows(days: int = 30) -> int:
    """Keep `model_health` for 30 days (section 15.5)."""
    cutoff = utcnow() - timedelta(days=days)
    async with SessionLocal() as session:
        result = await session.execute(delete(ModelHealth).where(ModelHealth.checked_at < cutoff))
        await session.commit()
    return result.rowcount or 0


async def run_daily_rollups() -> dict:
    from dubber_center.services.stats import rollup_day, rollup_uptime

    today = utcnow().date()
    written_stats = 0
    written_uptime = 0
    async with SessionLocal() as session:
        for offset in (1, 0):  # yesterday then today
            day = today - timedelta(days=offset)
            written_stats += await rollup_day(session, day)
            written_uptime += await rollup_uptime(session, day)
    return {"daily_stats": written_stats, "uptime": written_uptime}