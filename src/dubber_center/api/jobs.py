"""Job endpoints: create, read, list, cancel, usage (steps 6, 11)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.deps import CurrentUser
from dubber_center.core.errors import Conflict
from dubber_center.db.base import get_session
from dubber_center.db.tables import Job, JobEvent, Model
from dubber_center.schemas.models import (
    DubCreateIn,
    DubCreateOut,
    JobDetailOut,
    JobEventOut,
    JobOut,
    JobOutputOut,
    UsageOut,
)
from dubber_center.services.jobs import (
    create_job,
    enqueue,
    get_job_for_user,
    list_jobs_for_user,
    request_cancel,
)
from dubber_center.services.usage import usage_summary

router = APIRouter(tags=["jobs"])


def _job_out(job: Job, model: Model | None) -> JobOut:
    return JobOut(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        stage=job.stage,
        model=job.model_id,
        model_name=model.name if model else None,
        source_lang=job.source_lang,
        target_lang=job.target_lang,
        minutes=job.minutes,
        estimate_cost=job.estimate_cost,
        cost=job.cost,
        output=JobOutputOut(**job.output) if job.output else None,
        error=job.error,
        error_code=job.error_code,
        cancel_requested=job.cancel_requested,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


async def _model_name(session: AsyncSession, model_id: str) -> Model | None:
    return await session.get(Model, model_id)


@router.post(
    "/dub",
    response_model=DubCreateOut,
    status_code=201,
    summary="Create a dubbing job",
    responses={409: {"description": "Model unavailable or disabled"}},
)
async def create_dub(
    payload: DubCreateIn,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> DubCreateOut:
    payload.validate_source()
    job, model = await create_job(session, user, payload, idempotency_key=idempotency_key)

    # enqueue only if this was a fresh job (idempotent replays return early)
    if job.status == "queued":
        await enqueue(job.id)

    return DubCreateOut(
        job_id=job.id,
        status=job.status,
        model=model.id,
        estimated_cost=job.estimate_cost or 0.0,
        minutes=job.minutes,
    )


@router.get("/jobs", summary="List my jobs")
async def list_my_jobs(
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
    status: str | None = Query(default=None),
    model: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
) -> dict:
    rows, total = await list_jobs_for_user(
        session, user, status=status, model_id=model, page=page, size=size
    )
    model_ids = {row.model_id for row in rows}
    models = {}
    if model_ids:
        models = {
            m.id: m
            for m in (await session.scalars(select(Model).where(Model.id.in_(model_ids)))).all()
        }
    return {
        "data": [_job_out(row, models.get(row.model_id)) for row in rows],
        "total": total,
        "page": page,
        "size": size,
    }


@router.get("/jobs/{job_id}", response_model=JobDetailOut, summary="Job status and result")
async def get_job(
    job_id: str,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> JobDetailOut:
    job = await get_job_for_user(session, user, job_id)
    model = await _model_name(session, job.model_id)
    events = (
        await session.scalars(
            select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.created_at)
        )
    ).all()

    base = _job_out(job, model)
    return JobDetailOut(
        **base.model_dump(),
        events=[
            JobEventOut(status=e.status, message=e.message, created_at=e.created_at)
            for e in events
        ],
        options=job.options or {},
        attempts=job.attempts,
    )


@router.post("/jobs/{job_id}/cancel", summary="Cancel a job")
async def cancel_job(
    job_id: str,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    job = await get_job_for_user(session, user, job_id)
    if job.status in {"done", "failed", "canceled"}:
        raise Conflict(f"Job is already {job.status}.")
    await request_cancel(session, job)
    return {"job_id": job.id, "status": job.status, "cancel_requested": True}


@router.get("/usage", response_model=UsageOut, summary="My usage and cost")
async def my_usage(
    user: CurrentUser,
    session: AsyncSession = Depends(get_session),
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
) -> UsageOut:
    return UsageOut(
        **await usage_summary(session, user_id=user.id, from_date=from_date, to_date=to_date)
    )