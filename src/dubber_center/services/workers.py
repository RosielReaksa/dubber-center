"""Worker heartbeats (section 14.4): a Redis key per worker, refreshed every 10 s."""

from __future__ import annotations

import platform
import socket
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.config import settings
from dubber_center.db.tables import Job

HEARTBEAT_TTL = 30
_KEY = "worker:{worker_id}"

# Fallback registry for deployments without Redis.
_local: dict[str, dict] = {}


async def _redis():
    if not settings.redis_enabled:
        return None
    import redis.asyncio as aioredis

    return aioredis.from_url(settings.redis_url, decode_responses=True)


async def heartbeat(worker_id: str, *, model: str | None, job_id: str | None) -> None:
    payload = {
        "worker_id": worker_id,
        "host": socket.gethostname(),
        "pid": str(__import__("os").getpid()),
        "platform": platform.platform(),
        "model": model or "",
        "job_id": job_id or "",
        "at": str(int(time.time())),
    }
    client = await _redis()
    if client is None:
        _local[worker_id] = payload
        return
    try:
        import json

        await client.set(_KEY.format(worker_id=worker_id), json.dumps(payload), ex=HEARTBEAT_TTL)
    finally:
        await client.aclose()


async def read_heartbeats(session: AsyncSession) -> list[dict]:
    client = await _redis()
    if client is None:
        return _with_online(_local.values())

    try:
        import json

        keys = [key async for key in client.scan_iter("worker:*")]
        entries = []
        for key in keys:
            raw = await client.get(key)
            if raw:
                entries.append(json.loads(raw))
        return _with_online(entries)
    finally:
        await client.aclose()


def _with_online(entries) -> list[dict]:
    now = int(time.time())
    out = []
    for entry in entries:
        at = int(entry.get("at") or 0)
        out.append({**entry, "online": now - at < HEARTBEAT_TTL, "age_sec": now - at})
    return sorted(out, key=lambda e: e["worker_id"])


async def current_work(session: AsyncSession) -> list[dict]:
    """Which jobs are running and on which worker (fallback when no heartbeat)."""
    rows = (
        await session.scalars(select(Job).where(Job.status == "running").limit(50))
    ).all()
    return [{"job_id": j.id, "model": j.model_id, "worker_id": j.worker_id} for j in rows]