"""Arq worker settings.

    arq dubber_center.worker.settings.WorkerSettings

Two queues: `dubber_center:jobs` for user jobs and `dubber_center:health` for
monitoring, so a busy GPU queue never blocks health checks (section 15.9).
"""

from __future__ import annotations

from arq import cron
from arq.connections import RedisSettings

from dubber_center.config import settings
from dubber_center.core.logging import configure_logging
from dubber_center.worker import health_tasks, tasks


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url or "redis://localhost:6379/0")


async def startup(ctx) -> None:
    configure_logging()
    ctx["worker_id"] = f"worker-{settings.app_env}"
    from dubber_center.db.base import ensure_schema

    await ensure_schema()


async def shutdown(ctx) -> None:
    return None


async def sweep_cron(ctx) -> None:
    from dubber_center.db.base import SessionLocal

    async with SessionLocal() as session:
        result = await tasks.sweep_stuck_jobs(session)
    if result["count"]:
        import logging

        logging.getLogger("dubber_center.worker").warning("swept stuck jobs", extra=result)


async def ping_cron(ctx) -> None:
    await health_tasks.run_ping_round()


async def evaluate_cron(ctx) -> None:
    await health_tasks.evaluate_all_models()


async def canary_cron(ctx) -> None:
    await health_tasks.run_canary_round()


async def stats_cron(ctx) -> None:
    from dubber_center.services.stats import rollup_today

    await rollup_today()


async def daily_cron(ctx) -> None:
    from dubber_center.services.maintenance import run_daily_rollups

    await run_daily_rollups()


async def cleanup_cron(ctx) -> None:
    from dubber_center.services.maintenance import cleanup_expired_files

    await cleanup_expired_files()


class WorkerSettings:
    functions = [
        tasks.run_job,
        health_tasks.check_model,
        health_tasks.ping_model,
        health_tasks.run_canary,
    ]
    cron_jobs = [
        cron(
            sweep_cron,
            minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55},
            run_at_startup=False,
        ),
        cron(ping_cron, second={0, 30}, run_at_startup=False),
        cron(evaluate_cron, second={15}, run_at_startup=False),
        cron(canary_cron, minute={7, 37}, run_at_startup=False),
        cron(
            stats_cron,
            minute={2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57},
            run_at_startup=False,
        ),
        cron(daily_cron, hour={0}, minute={20}, run_at_startup=False),
        cron(cleanup_cron, hour={3}, minute={30}, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_settings()
    max_jobs = 10
    job_timeout = 3600 * 3
    keep_result = 3600
    queue_name = "dubber_center:jobs"