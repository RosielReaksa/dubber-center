"""Queue abstraction: Arq on Redis in production, in-process in development.

`REDIS_URL=` (empty) selects the in-process queue, which runs the job coroutine as a
background task. That keeps the API and the "worker" steps testable without Redis.
"""

from __future__ import annotations

import asyncio
from typing import Any, Protocol

from dubber_center.config import settings
from dubber_center.core.logging import get_logger

log = get_logger("dubber_center.queue")

_QUEUE_NAME = "dubber_center:jobs"
_HEALTH_QUEUE = "dubber_center:health"


class Queue(Protocol):
    async def enqueue_job(self, job_id: str) -> None: ...
    async def enqueue_health_check(self, model_id: str) -> None: ...
    async def queue_length(self) -> int: ...
    def close(self) -> None: ...


class InProcessQueue:
    """Runs jobs in the API process. Dev and tests only.

    Jobs still go through the same `run_job` implementation, so behavior matches
    the real worker; they just are not durable across a restart.
    """

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task] = set()

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def enqueue_job(self, job_id: str) -> None:
        from dubber_center.worker.tasks import run_job

        self._spawn(run_job(None, job_id))

    async def enqueue_health_check(self, model_id: str) -> None:
        from dubber_center.worker.health_tasks import check_model

        self._spawn(check_model(None, model_id))

    async def queue_length(self) -> int:
        return len(self._tasks)

    def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()


class ArqQueue:
    def __init__(self, redis_url: str) -> None:
        self.redis_url = redis_url
        self._pool = None

    async def _get_pool(self):
        if self._pool is None:
            from arq import create_pool
            from arq.connections import RedisSettings

            self._pool = await create_pool(RedisSettings.from_dsn(self.redis_url))
        return self._pool

    async def enqueue_job(self, job_id: str) -> None:
        pool = await self._get_pool()
        await pool.enqueue_job("run_job", job_id, _queue_name=_QUEUE_NAME)

    async def enqueue_health_check(self, model_id: str) -> None:
        pool = await self._get_pool()
        await pool.enqueue_job("check_model", model_id, _queue_name=_HEALTH_QUEUE)

    async def queue_length(self) -> int:
        pool = await self._get_pool()
        try:
            return int(await pool.zcard(_QUEUE_NAME))
        except Exception:
            return 0

    def close(self) -> None:
        self._pool = None


_queue: Queue | None = None


def get_queue() -> Queue:
    global _queue
    if _queue is None:
        _queue = ArqQueue(settings.redis_url) if settings.redis_enabled else InProcessQueue()
        log.info(
            "queue ready",
            extra={"backend": "arq" if settings.redis_enabled else "in-process"},
        )
    return _queue


def reset_queue() -> None:
    global _queue
    if _queue is not None:
        _queue.close()
    _queue = None


def queue_names() -> dict[str, Any]:
    return {"jobs": _QUEUE_NAME, "health": _HEALTH_QUEUE}