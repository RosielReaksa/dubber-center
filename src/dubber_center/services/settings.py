"""Settings with a 30 second cache so workers pick up changes without a restart."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.db.tables import Setting
from dubber_center.worker.health_tasks import DEFAULT_SETTINGS as HEALTH_DEFAULTS

DEFAULTS: dict[str, Any] = {
    **HEALTH_DEFAULTS,
    "rate_limit.per_minute": 120,
    "file.retention_days": 7,
    "alerts.failure_rate_threshold": 0.5,
    "alerts.failure_rate_min_jobs": 10,
    "alerts.max_queue_wait_minutes": 30,
    "alerts.low_credit_threshold": 5.0,
    "jobs.allow_unknown_models": True,
    "billing.credits_enabled": True,
}

_CACHE_TTL = 30.0
_cache: dict[str, Any] = {}
_cache_at: float = 0.0

# keys an admin may never write through the API
_READ_ONLY = {"webhook.secret"}


async def load_settings(session: AsyncSession, *, force: bool = False) -> dict[str, Any]:
    global _cache, _cache_at
    now = time.monotonic()
    if not force and _cache and now - _cache_at < _CACHE_TTL:
        return dict(_cache)

    merged = dict(DEFAULTS)
    rows = (await session.scalars(select(Setting))).all()
    for row in rows:
        merged[row.key] = row.value

    _cache = merged
    _cache_at = now
    return dict(merged)


def invalidate_cache() -> None:
    global _cache_at
    _cache_at = 0.0


async def set_settings_bulk(
    session: AsyncSession, values: dict[str, Any], *, actor_id: str | None
) -> dict[str, dict]:
    """Upsert settings. Returns {key: {before, after}} for the audit log."""
    changes: dict[str, dict] = {}
    existing = {
        row.key: row for row in (await session.scalars(select(Setting))).all()
    }
    for key, value in values.items():
        if key in _READ_ONLY:
            continue
        row = existing.get(key)
        before = row.value if row else DEFAULTS.get(key)
        if row is None:
            session.add(Setting(key=key, value=value, updated_by=actor_id))
        else:
            row.value = value
            row.updated_by = actor_id
        if before != value:
            changes[key] = {"before": before, "after": value}
    await session.commit()
    invalidate_cache()
    return changes


async def get_setting(session: AsyncSession, key: str, default: Any = None) -> Any:
    values = await load_settings(session)
    return values.get(key, default)