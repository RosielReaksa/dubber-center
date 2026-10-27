"""Job creation, listing and state transitions (steps 6, 7, 9)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.config import settings
from dubber_center.core.errors import AppError, Conflict, InsufficientCredits, NotFound
from dubber_center.db.base import utcnow
from dubber_center.db.tables import File, Job, JobEvent, Model, User
from dubber_center.registry.service import (
    ensure_request_ok,
    get_model,
    row_to_manifest,
)
from dubber_center.schemas.models import DubCreateIn, JobOutputOut
from dubber_center.services.storage import Storage

if TYPE_CHECKING:
    from dubber_center.adapters.base import JobOutput

ACTIVE_STATES = {"queued", "running"}
FINAL_STATES = {"done", "failed", "canceled"}


# --- creation ------------------------------------------------------------


async def resolve_video_input(
    session: AsyncSession, user: User, payload: DubCreateIn
) -> tuple[str | None, str | None]:
    """Validate the video source. Returns (file_id, url)."""
    if payload.file_id:
        file_row = await session.get(File, payload.file_id)
        if file_row is None or file_row.user_id != user.id:
            raise NotFound("File not found.")
        return file_row.id, None
    return None, str(payload.video_url)


async def create_job(
    session: AsyncSession,
    user: User,
    payload: DubCreateIn,
    *,
    idempotency_key: str | None = None,
    is_canary: bool = False,
    model_override: str | None = None,
) -> tuple[Job, Model]:
    model_id = model_override or payload.model

    # Idempotency: replaying the same key returns the original job.
    if idempotency_key and not is_canary:
        existing = await session.scalar(
            select(Job).where(
                Job.user_id == user.id, Job.idempotency_key == idempotency_key
            )
        )
        if existing is not None:
            model_row = await get_model(session, existing.model_id)
            return existing, model_row

    model_row = await get_model(session, model_id)
    manifest = row_to_manifest(model_row)

    ensure_request_ok(
        model_row,
        manifest,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        minutes=payload.minutes,
    )

    # Credits gate (only when billing is on for the user).
    estimate = manifest.estimate_cost(payload.minutes or 0.0)
    if user.credits <= 0 and not is_canary:
        raise InsufficientCredits(
            "You are out of credits. Add credits to start a new job.",
            details={"balance": user.credits, "estimated_cost": estimate},
        )
    if user.credits > 0 and estimate > user.credits:
        raise InsufficientCredits(
            "The estimated cost is higher than your balance.",
            details={"balance": user.credits, "estimated_cost": estimate},
        )

    file_id, url = await resolve_video_input(session, user, payload)

    job = Job(
        user_id=user.id,
        model_id=model_row.id,
        status="queued",
        input_file_id=file_id,
        input_url=url,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        options=(payload.options.merged() if payload.options else {}),
        minutes=payload.minutes,
        estimate_cost=estimate,
        webhook_url=str(payload.webhook_url) if payload.webhook_url else None,
        idempotency_key=idempotency_key,
        is_canary=is_canary,
    )
    session.add(job)
    await session.flush()
    await write_event(session, job, "queued", "Job created")
    await session.commit()
    await session.refresh(job)
    return job, model_row


async def enqueue(job_id: str) -> None:
    from dubber_center.services.queue import get_queue

    await get_queue().enqueue_job(job_id)


# --- reads ---------------------------------------------------------------


async def get_job_for_user(session: AsyncSession, user: User, job_id: str) -> Job:
    job = await session.get(Job, job_id)
    if job is None:
        raise NotFound("Job not found.")
    if job.user_id != user.id and user.role == "user":
        raise NotFound("Job not found.")  # never reveal other users' jobs
    if job.is_canary and user.role == "user":
        raise NotFound("Job not found.")
    return job


async def list_jobs_for_user(
    session: AsyncSession,
    user: User,
    *,
    status: str | None = None,
    model_id: str | None = None,
    page: int = 1,
    size: int = 20,
) -> tuple[list[Job], int]:
    conditions = [
        Job.user_id == user.id,
        Job.is_canary.is_(False),
    ]
    if status:
        conditions.append(Job.status == status)
    if model_id:
        conditions.append(Job.model_id == model_id)

    total = await session.scalar(select(func.count()).select_from(Job).where(*conditions))
    rows = (
        await session.scalars(
            select(Job)
            .where(*conditions)
            .order_by(Job.created_at.desc())
            .offset((page - 1) * size)
            .limit(size)
        )
    ).all()
    return list(rows), int(total or 0)


# --- state ---------------------------------------------------------------


async def write_event(
    session: AsyncSession,
    job: Job,
    status: str,
    message: str | None = None,
    detail: dict | None = None,
) -> None:
    session.add(JobEvent(job_id=job.id, status=status, message=message, detail=detail))


async def transition(
    session: AsyncSession,
    job: Job,
    status: str,
    *,
    message: str | None = None,
    commit: bool = True,
) -> None:
    if job.status == status:
        return
    job.status = status
    if status == "running" and job.started_at is None:
        job.started_at = utcnow()
    if status in FINAL_STATES:
        job.finished_at = utcnow()
    await write_event(session, job, status, message)
    if commit:
        await session.commit()


async def request_cancel(session: AsyncSession, job: Job) -> Job:
    if job.status in FINAL_STATES:
        raise Conflict(f"Job is already {job.status}.")
    job.cancel_requested = True
    await write_event(session, job, "cancel_requested", "Cancellation requested")
    await session.commit()
    return job


async def finalize_outputs(storage: Storage, job: Job, output: JobOutput) -> dict:
    """Upload model output files to storage and return public download URLs.

    Paths may be local files or http URLs (an http-runner model returns URLs).
    """
    candidates = {
        "video_url": (output.video_path, "mp4"),
        "audio_url": (output.audio_path, "mp3"),
        "subtitles_url": (output.subtitles_path, "srt"),
        "timing_json_url": (output.timing_json_path, "json"),
    }
    out: dict[str, str] = {}

    for url_key, (path, ext) in candidates.items():
        if not path:
            continue
        if str(path).startswith(("http://", "https://")):
            out[url_key] = str(path)
            continue

        local = Path(path)
        if not await asyncio.to_thread(local.exists):
            continue
        storage_key = f"out/{job.user_id}/{job.id}/{url_key.removesuffix('_url')}.{ext}"
        await storage.put_bytes(storage_key, await asyncio.to_thread(local.read_bytes))
        out[url_key] = storage.presign_download(storage_key)
    return out


def output_from_job(job: Job) -> JobOutputOut | None:
    if not job.output:
        return None
    return JobOutputOut(
        video_url=job.output.get("video_url"),
        audio_url=job.output.get("audio_url"),
        subtitles_url=job.output.get("subtitles_url"),
        timing_json_url=job.output.get("timing_json_url"),
    )


def job_to_dict(job: Job, model_name: str | None = None) -> dict:
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "stage": job.stage,
        "model": job.model_id,
        "model_name": model_name,
        "source_lang": job.source_lang,
        "target_lang": job.target_lang,
        "minutes": job.minutes,
        "estimate_cost": job.estimate_cost,
        "cost": job.cost,
        "output": job.output,
        "error": job.error,
        "error_code": job.error_code,
        "cancel_requested": job.cancel_requested,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def minutes_from_job(job: Job) -> float:
    if job.minutes:
        return job.minutes
    if job.started_at and job.finished_at:
        return max((job.finished_at - job.started_at).total_seconds() / 60, 0.0)
    return 0.0


def utcnow_utc() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "ACTIVE_STATES",
    "FINAL_STATES",
    "AppError",
    "create_job",
    "enqueue",
    "finalize_outputs",
    "get_job_for_user",
    "job_to_dict",
    "list_jobs_for_user",
    "output_from_job",
    "request_cancel",
    "settings",
    "transition",
    "write_event",
]