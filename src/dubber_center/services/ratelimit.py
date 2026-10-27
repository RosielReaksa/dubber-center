"""Per-key rate limiting (project plan step 13).

Redis fixed-window counter when available; an in-process counter otherwise so the
limit still applies in dev and tests.
"""

from __future__ import annotations

import time

from dubber_center.config import settings

_WINDOW_SEC = 60
_local: dict[str, tuple[int, float]] = {}
_redis = None


async def _client():
    global _redis
    if not settings.redis_enabled:
        return None
    if _redis is None:
        import redis.asyncio as aioredis

        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def check_rate_limit(identity: str, limit: int) -> tuple[bool, int, int]:
    """Returns (allowed, remaining, retry_after_sec)."""
    window_start = int(time.time() // _WINDOW_SEC)
    key = f"rl:{identity}:{window_start}"

    client = await _client()
    if client is not None:
        try:
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, _WINDOW_SEC)
            remaining = max(0, limit - count)
            return count <= limit, remaining, _WINDOW_SEC
        except Exception:
            pass  # fall through to the local counter

    now = time.monotonic()
    count, started = _local.get(identity, (0, now))
    if now - started > _WINDOW_SEC:
        count, started = 0, now
    count += 1
    _local[identity] = (count, started)
    return count <= limit, max(0, limit - count), _WINDOW_SEC


def reset_rate_limits() -> None:
    _local.clear()