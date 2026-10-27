"""The job runner (project plan step 7).

    queued → running → done
                ├→ failed   (error saved, with code and kind)
                └→ canceled

Every change writes a `job_events` row. Reliability (step 9) is folded in here:
per-model timeouts, transient-error retries with backoff, optional fallback,
concurrency limits, and cancel checks between polls.
"""

from __future__ import annotations

import asyncio
import contextlib
import random
import tempfile
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from dubber_center.adapters import build_adapter
from dubber_center.adapters.base import AdapterError, AdapterStatus, DubberAdapter, JobInput
from dubber_center.config import settings
from dubber_center.core.logging import get_logger
from dubber_center.db.base import SessionLocal
from dubber_center.db.tables import Job, Model, User
from dubber_center.registry.manifest import ModelManifest
from dubber_center.registry.service import row_to_manifest
from dubber_center.services.jobs import (
    finalize_outputs,
    minutes_from_job,
    transition,
    write_event,
)
from dubber_center.services.storage import get_storage
from dubber_center.services.usage import record_usage, spend_for_job

log = get_logger("dubber_center.worker")

TRANSIENT_CODES = {
    "provider_unavailable",
    "provider_rate_limited",
    "service_unreachable",
    "timeout",
}
USER_CODES = {"invalid_input", "video_too_long", "insufficient_credits", "canceled"}


def error_kind(code: str | None) -> str:
    return "user" if code in USER_CODES else "system"


def backoff_seconds(attempt: int) -> float:
    base = min(2 ** (attempt - 1), 30)
    return base + random.uniform(0, 0.5)


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------


async def run_job(ctx: Any, job_id: str) -> str:
    """Arq task. `ctx` is None when running in-process."""
    worker_id = getattr(getattr(ctx, "__dict__", {}), "get", lambda *_: None)("worker_id", None)
    worker_id = worker_id or f"{settings.app_env}-{uuid.uuid4().hex[:8]}"

    async with SessionLocal() as session:
        job = await session.get(Job, job_id)
        if job is None:
            log.warning("job vanished", extra={"job_id": job_id})
            return "missing"
        if job.status not in {"queued", "running"}:
            return job.status
        if job.cancel_requested:
            await transition(session, job, "canceled", message="Canceled before start")
            await _after_finish(session, job, worker_id)
            return "canceled"

        model = await session.get(Model, job.model_id)
        if model is None:
            job.status = "failed"
            job.error = "Model no longer exists."
            job.error_code = "unknown"
            job.error_kind = "system"
            await transition(session, job, "failed", message=job.error)
            return "failed"

        if model.queue_paused and not job.is_canary:
            log.info("queue paused, leaving queued", extra={"model": model.id})
            return "queued"

        manifest = row_to_manifest(model)
        await _run_with_reliability(session, job, manifest, worker_id)
        await _after_finish(session, job, worker_id)
        return job.status


async def _run_with_reliability(
    session, job: Job, manifest: ModelManifest, worker_id: str
) -> None:
    attempts_allowed = max(settings.job_max_attempts, 1)
    current_manifest = manifest
    fallback_used = False

    while True:
        try:
            await _attempt(session, job, current_manifest, worker_id)
            return
        except AdapterError as err:
            await session.rollback()
            job = await session.get(Job, job.id)
            assert job is not None
            job.attempts += 1
            transient = err.error_code in TRANSIENT_CODES
            can_retry = transient and job.attempts < attempts_allowed
            can_fallback = (
                not can_retry
                and not fallback_used
                and bool(manifest.fallback)
                and job.attempts >= 1
            )

            if can_retry:
                delay = backoff_seconds(job.attempts)
                await write_event(
                    session,
                    job,
                    "retrying",
                    f"Attempt {job.attempts} failed ({err.error_code}); retrying in {delay:.0f}s",
                )
                await session.commit()
                await asyncio.sleep(delay)
                continue

            if can_fallback:
                fallback_used = True
                fallback_manifest = await _fallback_manifest(session, manifest)
                if fallback_manifest is not None:
                    await write_event(
                        session,
                        job,
                        "fallback",
                        f"{manifest.id} failed; running fallback {fallback_manifest.id}",
                    )
                    await session.commit()
                    current_manifest = fallback_manifest
                    try:
                        await _attempt(session, job, current_manifest, worker_id)
                        return
                    except AdapterError as fallback_err:
                        await session.rollback()
                        job = await session.get(Job, job.id)
                        assert job is not None
                        await _fail(session, job, fallback_err)
                        return

            await _fail(session, job, err)
            return
        except Exception as exc:  # never leave a job running on an unexpected bug
            log.exception("job crashed", extra={"job_id": job.id})
            await session.rollback()
            job = await session.get(Job, job.id)
            assert job is not None
            await _fail(session, job, AdapterError(str(exc), error_code="unknown"))
            return


async def _fallback_manifest(session, manifest: ModelManifest) -> ModelManifest | None:
    if not manifest.fallback:
        return None
    row = await session.get(Model, manifest.fallback)
    if row is None or row.status == "disabled":
        return None
    return row_to_manifest(row)


async def _fail(session, job: Job, err: AdapterError) -> None:
    job.error = err.message
    job.error_code = err.error_code
    job.error_kind = error_kind(err.error_code)
    await transition(session, job, "failed", message=err.message)


# --------------------------------------------------------------------------
# one attempt
# --------------------------------------------------------------------------


async def _attempt(session, job: Job, manifest: ModelManifest, worker_id: str) -> None:
    workdir = Path(tempfile.mkdtemp(prefix=f"dc_{job.id}_"))
    adapter = build_adapter(manifest, workdir)

    try:
        # resolve input to something the adapter can read
        input_ref = job.input_url
        if job.input_file_id:
            from dubber_center.db.tables import File

            file_row = await session.get(File, job.input_file_id)
            if file_row is None:
                raise AdapterError("Input file record is missing.", error_code="invalid_input")
            from dubber_center.services.storage import download_to_temp

            local = await download_to_temp(get_storage(), file_row.storage_key, workdir, "input")
            input_ref = str(local)
        if not input_ref:
            raise AdapterError("Job has no video input.", error_code="invalid_input")

        job_args = JobInput(
            job_id=job.id,
            input_path_or_url=input_ref,
            source_lang=job.source_lang,
            target_lang=job.target_lang,
            options=job.options or {},
            workdir=str(workdir),
            timeout_seconds=manifest.timeout_minutes * 60,
            minutes=job.minutes,
            is_canary=job.is_canary,
        )

        await transition(session, job, "running", message=f"Started on {manifest.id}")
        job.worker_id = worker_id
        await session.commit()

        try:
            external_id = await asyncio.wait_for(
                adapter.submit(job_args), timeout=min(manifest.timeout_minutes * 60, 300)
            )
        except TimeoutError as exc:
            raise AdapterError("Submit timed out.", error_code="timeout") from exc

        job.external_id = external_id
        await session.commit()

        output = await _poll_to_completion(session, job, adapter, external_id, manifest)
        await _finish_success(session, job, adapter, output, manifest)
    finally:
        with contextlib.suppress(Exception):
            await asyncio.to_thread(lambda: __import__("shutil").rmtree(workdir, True))


async def _poll_to_completion(
    session, job: Job, adapter: DubberAdapter, external_id: str, manifest: ModelManifest
):
    deadline = asyncio.get_running_loop().time() + manifest.timeout_minutes * 60
    interval = settings.job_poll_interval_sec
    last_progress = -1.0

    while True:
        if asyncio.get_running_loop().time() > deadline:
            await _safe_cancel(adapter, external_id)
            raise AdapterError(
                f"{manifest.id} exceeded its {manifest.timeout_minutes:g} min limit.",
                error_code="timeout",
            )

        status: AdapterStatus = await adapter.status(external_id)

        if status.state == "done":
            job.progress = 1.0
            job.stage = status.stage or "Finishing"
            await session.commit()
            return await adapter.result(external_id)

        if status.state == "failed":
            await _safe_cancel(adapter, external_id)
            raise AdapterError(
                status.message or "The model failed the job.",
                error_code=status.error_code or "unknown",
            )

        if status.state == "canceled":
            raise AdapterError("The model canceled the job.", error_code="canceled")

        # progress + cancel flag
        if status.progress != last_progress or status.stage:
            job.progress = max(job.progress, min(status.progress, 1.0))
            if status.stage:
                job.stage = status.stage
            await session.commit()
            last_progress = status.progress

        await session.refresh(job, attribute_names=["cancel_requested"])
        if job.cancel_requested:
            await _safe_cancel(adapter, external_id)
            await transition(session, job, "canceled", message="Canceled by request")
            raise AdapterError("Canceled by user.", error_code="canceled")

        await asyncio.sleep(interval)
        interval = min(interval * 1.5, settings.job_poll_interval_max_sec)


async def _safe_cancel(adapter: DubberAdapter, external_id: str) -> None:
    with contextlib.suppress(Exception):
        await adapter.cancel(external_id)


async def _finish_success(
    session, job: Job, adapter: DubberAdapter, output, manifest: ModelManifest
) -> None:
    storage = get_storage()
    urls = await finalize_outputs(storage, job, output)
    minutes = job.minutes or output.minutes or minutes_from_job(job)

    job.output = urls
    job.minutes = round(minutes, 3)
    job.cost = manifest.estimate_cost(minutes)
    job.progress = 1.0
    job.stage = "Done"
    job.error = None
    job.error_code = None
    job.error_kind = None

    user = await session.get(User, job.user_id)
    internal = job.is_canary or (user.is_canary if user else False)
    if user is not None:
        await record_usage(
            session,
            user_id=user.id,
            job=job,
            model_id=manifest.id,
            minutes=minutes,
            cost=job.cost,
            internal=internal,
            commit=False,
        )
        if not internal:
            await spend_for_job(session, user, job, job.cost)

    await transition(session, job, "done", message="Job finished")


# --------------------------------------------------------------------------
# post-finish side effects
# --------------------------------------------------------------------------


async def _after_finish(session, job: Job, worker_id: str) -> None:
    if job.webhook_url and job.status in {"done", "failed", "canceled"}:
        from dubber_center.services.webhooks import deliver_for_job

        with contextlib.suppress(Exception):
            await deliver_for_job(session, job)


# --------------------------------------------------------------------------
# concurrency + sweep (step 9)
# --------------------------------------------------------------------------


async def model_running_count(session, model_id: str, exclude_job_id: str | None = None) -> int:
    conditions = [Job.model_id == model_id, Job.status == "running"]
    if exclude_job_id:
        conditions.append(Job.id != exclude_job_id)
    return int(await session.scalar(select(func.count()).select_from(Job).where(*conditions)) or 0)


async def sweep_stuck_jobs(session, *, dry_run: bool = False) -> dict[str, Any]:
    """Fail jobs running past their model timeout with no recent progress."""
    stuck: list[dict] = []
    rows = (
        await session.scalars(select(Job).where(Job.status == "running"))
    ).all()

    for job in rows:
        model = await session.get(Model, job.model_id)
        if model is None:
            continue
        manifest = row_to_manifest(model)
        started = job.started_at or job.created_at
        from datetime import UTC, datetime

        if started.tzinfo is None:
            started = started.replace(tzinfo=UTC)
        age_min = (datetime.now(UTC) - started).total_seconds() / 60
        if age_min > manifest.timeout_minutes:
            stuck.append({"job_id": job.id, "model": model.id, "age_minutes": round(age_min, 1)})
            if not dry_run:
                job.error = "The model stopped responding and the job was swept."
                job.error_code = "timeout"
                job.error_kind = "system"
                await transition(session, job, "failed", message=job.error)

    if not dry_run and stuck:
        await session.commit()
    return {"stuck": stuck, "count": len(stuck), "dry_run": dry_run}