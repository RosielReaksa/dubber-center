"""Admin: jobs, users/keys, usage, queue/workers, settings, audit (section 14.3)."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.admin.common import (
    Dangerous,
    Page,
    RequireAdmin,
    RequireOwner,
    RequireSupport,
    write_audit,
)
from dubber_center.api.deps import require_role
from dubber_center.core.errors import Conflict, NotFound
from dubber_center.core.security import key_prefix
from dubber_center.db.base import get_session, utcnow
from dubber_center.db.tables import (
    ApiKey,
    AuditLog,
    CreditTransaction,
    Job,
    JobEvent,
    Model,
    UsageLedger,
    User,
)
from dubber_center.services.jobs import request_cancel
from dubber_center.services.settings import DEFAULTS as SETTING_DEFAULTS
from dubber_center.services.settings import load_settings, set_settings_bulk
from dubber_center.services.usage import add_credits, usage_summary
from dubber_center.services.users import create_user, issue_api_key

# --------------------------------------------------------------------------
# jobs
# --------------------------------------------------------------------------

jobs_router = APIRouter(tags=["admin-jobs"], dependencies=[Depends(require_role("support"))])


@jobs_router.get("/jobs", summary="Search all jobs")
async def list_jobs(
    session: AsyncSession = Depends(get_session),
    page: Page = Depends(Page),
    status: str | None = None,
    model: str | None = None,
    user: str | None = Query(default=None, description="user id or email"),
    q: str | None = Query(default=None, description="job id"),
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    include_canary: bool = False,
    sort: str = Query(default="-created_at"),
) -> dict:
    conditions = []
    if not include_canary:
        conditions.append(Job.is_canary.is_(False))
    if status:
        conditions.append(Job.status == status)
    if model:
        conditions.append(Job.model_id == model)
    if user:
        user_row = await session.get(User, user)
        if user_row is None:
            user_row = await session.scalar(select(User).where(User.email == user.lower()))
        conditions.append(Job.user_id == (user_row.id if user_row else "__none__"))
    if q:
        conditions.append(Job.id.like(f"%{q}%"))
    if from_date:
        conditions.append(Job.created_at >= datetime.fromisoformat(from_date).replace(tzinfo=UTC))
    if to_date:
        conditions.append(
            Job.created_at < datetime.fromisoformat(to_date).replace(tzinfo=UTC) + timedelta(days=1)
        )

    sort_field = sort.lstrip("-")
    column = (
        Job.created_at
        if sort_field == "created_at"
        else getattr(Job, sort_field, Job.created_at)
    )
    ordering = column.desc() if sort.startswith("-") else column.asc()

    total = await session.scalar(select(func.count()).select_from(Job).where(*conditions))
    rows = (
        await session.scalars(
            select(Job).where(*conditions).order_by(ordering).offset(page.offset).limit(page.size)
        )
    ).all()

    return page.envelope([_job_row(job) for job in rows], int(total or 0))


def _job_row(job: Job) -> dict:
    return {
        "job_id": job.id,
        "user_id": job.user_id,
        "model": job.model_id,
        "status": job.status,
        "progress": job.progress,
        "source_lang": job.source_lang,
        "target_lang": job.target_lang,
        "cost": job.cost,
        "error": job.error,
        "error_code": job.error_code,
        "is_canary": job.is_canary,
        "attempts": job.attempts,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
    }


@jobs_router.get("/jobs/{job_id}", summary="Full job detail")
async def job_detail(job_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    job = await session.get(Job, job_id)
    if job is None:
        raise NotFound("Job not found.")
    events = (
        await session.scalars(
            select(JobEvent).where(JobEvent.job_id == job_id).order_by(JobEvent.created_at)
        )
    ).all()
    return {
        **_job_row(job),
        "input_file_id": job.input_file_id,
        "input_url": job.input_url,
        "output": job.output,
        "options": job.options,
        "minutes": job.minutes,
        "estimate_cost": job.estimate_cost,
        "error_kind": job.error_kind,
        "external_id": job.external_id,
        "worker_id": job.worker_id,
        "webhook_url": job.webhook_url,
        "admin_notes": job.admin_notes,
        "retried_from_job_id": job.retried_from_job_id,
        "started_at": job.started_at,
        "events": [
            {
                "status": e.status,
                "message": e.message,
                "detail": e.detail,
                "created_at": e.created_at,
            }
            for e in events
        ],
    }


@jobs_router.get("/jobs/{job_id}/files", summary="Presigned output URLs")
async def job_files(job_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    job = await session.get(Job, job_id)
    if job is None:
        raise NotFound("Job not found.")
    return {"job_id": job_id, "files": job.output or {}}


@jobs_router.get("/jobs/{job_id}/logs", summary="Job event log")
async def job_logs(job_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    events = (
        await session.scalars(
            select(JobEvent).where(JobEvent.job_id == job_id).order_by(JobEvent.created_at)
        )
    ).all()
    if not events:
        raise NotFound("Job not found.")
    return {
        "job_id": job_id,
        "events": [
            {
                "status": e.status,
                "message": e.message,
                "detail": e.detail,
                "created_at": e.created_at,
            }
            for e in events
        ],
    }


@jobs_router.post("/jobs/{job_id}/retry", summary="Retry a job")
async def retry_job(
    job_id: str, request: Request, actor: RequireSupport,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from dubber_center.schemas.models import DubCreateIn
    from dubber_center.services.jobs import create_job, enqueue

    original = await session.get(Job, job_id)
    if original is None:
        raise NotFound("Job not found.")
    if original.status not in {"failed", "canceled", "done"}:
        raise Conflict("Only finished jobs can be retried.")

    user = await session.get(User, original.user_id)
    assert user is not None
    payload = DubCreateIn(
        model=original.model_id,
        file_id=original.input_file_id,
        video_url=original.input_url if not original.input_file_id else None,
        source_lang=original.source_lang,
        target_lang=original.target_lang,
        minutes=original.minutes,
    )
    job, _ = await create_job(session, user, payload)
    job.retried_from_job_id = original.id
    await write_audit(
        session, actor, "job.retry", "job", job.id, after={"from": original.id},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    await enqueue(job.id)
    return {"job_id": job.id, "retried_from": original.id, "status": job.status}


@jobs_router.post("/jobs/{job_id}/cancel", summary="Cancel a job")
async def admin_cancel_job(
    job_id: str, request: Request, actor: RequireSupport,
    session: AsyncSession = Depends(get_session),
) -> dict:
    job = await session.get(Job, job_id)
    if job is None:
        raise NotFound("Job not found.")
    await request_cancel(session, job)
    await write_audit(
        session, actor, "job.cancel", "job", job_id,
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"job_id": job_id, "cancel_requested": True}


class JobPatchIn(BaseModel):
    admin_notes: str | None = Field(default=None, max_length=5000)


@jobs_router.patch("/jobs/{job_id}", summary="Edit admin notes")
async def patch_job(
    job_id: str, payload: JobPatchIn, request: Request, actor: RequireSupport,
    session: AsyncSession = Depends(get_session),
) -> dict:
    job = await session.get(Job, job_id)
    if job is None:
        raise NotFound("Job not found.")
    before = {"admin_notes": job.admin_notes}
    job.admin_notes = payload.admin_notes
    await write_audit(
        session, actor, "job.notes", "job", job_id, before=before,
        after={"admin_notes": payload.admin_notes},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"job_id": job_id, "admin_notes": job.admin_notes}


# --------------------------------------------------------------------------
# users and keys
# --------------------------------------------------------------------------

users_router = APIRouter(tags=["admin-users"], dependencies=[Depends(require_role("support"))])


class UserCreateIn(BaseModel):
    email: str
    name: str | None = None
    role: str = "user"
    plan: str = "free"
    credits: float = 0.0


class UserPatchIn(BaseModel):
    name: str | None = None
    plan: str | None = None
    role: str | None = None
    status: str | None = None


class CreditsIn(BaseModel):
    amount: float
    reason: str = Field(min_length=1, max_length=255)


class KeyCreateIn(BaseModel):
    name: str = "default"


def _user_row(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "plan": user.plan,
        "role": user.role,
        "status": user.status,
        "credits": user.credits,
        "created_at": user.created_at,
        "last_seen_at": user.last_seen_at,
    }


def _key_row(key: ApiKey) -> dict:
    # never the hash, never the raw key
    return {
        "id": key.id,
        "prefix": key.prefix,
        "name": key.name,
        "created_at": key.created_at,
        "last_used_at": key.last_used_at,
        "revoked_at": key.revoked_at,
    }


@users_router.get("/users", summary="List users")
async def list_users(
    session: AsyncSession = Depends(get_session),
    page: Page = Depends(Page),
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
) -> dict:
    conditions = []
    if q:
        like = f"%{q.lower()}%"
        conditions.append(or_(func.lower(User.email).like(like), func.lower(User.name).like(like)))
    if role:
        conditions.append(User.role == role)
    if status:
        conditions.append(User.status == status)

    total = await session.scalar(select(func.count()).select_from(User).where(*conditions))
    rows = (
        await session.scalars(
            select(User).where(*conditions).order_by(User.created_at.desc())
            .offset(page.offset).limit(page.size)
        )
    ).all()

    data = []
    for user in rows:
        jobs = await session.scalar(
            select(func.count()).select_from(Job).where(Job.user_id == user.id)
        )
        data.append({**_user_row(user), "jobs": int(jobs or 0)})
    return page.envelope(data, int(total or 0))


@users_router.post("/users", status_code=201, summary="Create a user and key")
async def create_user_admin(
    payload: UserCreateIn, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await create_user(
        session,
        email=payload.email,
        name=payload.name,
        role=payload.role,
        credits=0.0,
        plan=payload.plan,
    )
    raw_key = await issue_api_key(session, user)
    if payload.credits:
        await add_credits(
            session, user, payload.credits, reason="Initial credit (admin)",
            actor_user_id=actor.id, commit=False,
        )
    await write_audit(
        session, actor, "user.create", "user", user.id,
        after={"email": user.email, "role": user.role, "plan": user.plan},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {**_user_row(user), "api_key": raw_key, "key_prefix": key_prefix(raw_key)}


@users_router.get("/users/{user_id}", summary="User detail")
async def get_user(user_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("User not found.")
    keys = (await session.scalars(select(ApiKey).where(ApiKey.user_id == user_id))).all()
    recent_jobs = (
        await session.scalars(
            select(Job).where(Job.user_id == user_id).order_by(Job.created_at.desc()).limit(20)
        )
    ).all()
    transactions = (
        await session.scalars(
            select(CreditTransaction)
            .where(CreditTransaction.user_id == user_id)
            .order_by(CreditTransaction.created_at.desc())
            .limit(50)
        )
    ).all()
    return {
        **_user_row(user),
        "keys": [_key_row(k) for k in keys],
        "recent_jobs": [_job_row(j) for j in recent_jobs],
        "credit_transactions": [
            {
                "id": t.id,
                "amount": t.amount,
                "balance_after": t.balance_after,
                "reason": t.reason,
                "job_id": t.job_id,
                "created_at": t.created_at,
            }
            for t in transactions
        ],
    }


@users_router.patch("/users/{user_id}", summary="Edit plan, role or status")
async def patch_user(
    user_id: str, payload: UserPatchIn, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("User not found.")

    if payload.role is not None and payload.role in {"admin", "owner"} and actor.role != "owner":
        from dubber_center.core.errors import Forbidden

        raise Forbidden("Only an owner can grant admin or owner roles.")

    before = {key: getattr(user, key) for key in payload.model_dump(exclude_none=True)}
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(user, key, value)
    after = {key: getattr(user, key) for key in before}

    await write_audit(
        session, actor, "user.update", "user", user_id, before=before, after=after,
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return _user_row(user)


@users_router.post("/users/{user_id}/credits", summary="Add credits (ledger only)")
async def add_user_credits(
    user_id: str, payload: CreditsIn, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("User not found.")
    previous = user.credits
    balance = await add_credits(
        session, user, payload.amount, reason=payload.reason, actor_user_id=actor.id, commit=False
    )
    await write_audit(
        session, actor, "user.credits", "user", user_id,
        before={"credits": previous}, after={"credits": balance, "reason": payload.reason},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"user_id": user_id, "balance": balance}


@users_router.get("/users/{user_id}/keys", summary="List keys (prefixes only)")
async def list_user_keys(user_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    keys = (
        await session.scalars(
            select(ApiKey).where(ApiKey.user_id == user_id).order_by(ApiKey.created_at.desc())
        )
    ).all()
    return {"data": [_key_row(k) for k in keys]}


@users_router.post("/users/{user_id}/keys", status_code=201, summary="Create a key (shown once)")
async def create_user_key(
    user_id: str, payload: KeyCreateIn, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("User not found.")
    raw = await issue_api_key(session, user, name=payload.name)
    await write_audit(
        session, actor, "key.create", "user", user_id, after={"prefix": key_prefix(raw)},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"key": raw, "prefix": key_prefix(raw)}


@users_router.delete("/keys/{key_id}", summary="Revoke a key (dry run aware)")
async def revoke_key(
    key_id: str, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
    danger: Dangerous = Depends(Dangerous),
) -> dict:
    key = await session.get(ApiKey, key_id)
    if key is None:
        raise NotFound("Key not found.")
    if danger.dry_run:
        return {
            "dry_run": True,
            "key_id": key_id,
            "will_affect": {"revoked": key.revoked_at is not None},
            "prefix": key.prefix,
        }
    danger.require_confirm()
    if key.revoked_at is not None:
        raise Conflict("Key is already revoked.")
    key.revoked_at = utcnow()
    await write_audit(
        session, actor, "key.revoke", "key", key_id, after={"prefix": key.prefix},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"key_id": key_id, "revoked_at": key.revoked_at}


# --------------------------------------------------------------------------
# usage
# --------------------------------------------------------------------------

usage_router = APIRouter(tags=["admin-usage"], dependencies=[Depends(require_role("support"))])


@usage_router.get("/usage", summary="Usage grouped by model, user or day")
async def admin_usage(
    session: AsyncSession = Depends(get_session),
    group_by: str = "model",
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
) -> dict:
    summary = await usage_summary(
        session, from_date=from_date, to_date=to_date, include_internal=True
    )
    if group_by == "user":
        return {**summary, "by_user": await _usage_by_user(session, from_date, to_date)}
    return summary


async def _usage_by_user(
    session: AsyncSession, from_date: str | None, to_date: str | None
) -> list[dict]:
    start = (
        datetime.fromisoformat(from_date).replace(tzinfo=UTC)
        if from_date
        else utcnow() - timedelta(days=30)
    )
    end = (
        datetime.fromisoformat(to_date).replace(tzinfo=UTC) + timedelta(days=1)
        if to_date
        else utcnow()
    )
    rows = (
        await session.execute(
            select(
                UsageLedger.user_id,
                func.sum(UsageLedger.minutes),
                func.sum(UsageLedger.cost),
                func.count(),
            )
            .where(UsageLedger.created_at >= start, UsageLedger.created_at < end)
            .group_by(UsageLedger.user_id)
        )
    ).all()
    return [
        {
            "user_id": user_id,
            "minutes": round(minutes or 0, 3),
            "cost": round(cost or 0, 4),
            "jobs": int(count),
        }
        for user_id, minutes, cost, count in rows
    ]


@usage_router.get("/usage/export.csv", summary="Usage CSV export")
async def export_usage_csv(
    session: AsyncSession = Depends(get_session),
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
) -> PlainTextResponse:
    start = (
        datetime.fromisoformat(from_date).replace(tzinfo=UTC)
        if from_date
        else utcnow() - timedelta(days=30)
    )
    end = (
        datetime.fromisoformat(to_date).replace(tzinfo=UTC) + timedelta(days=1)
        if to_date
        else utcnow()
    )
    rows = (
        await session.execute(
            select(
                UsageLedger.model_id,
                UsageLedger.user_id,
                UsageLedger.minutes,
                UsageLedger.cost,
                UsageLedger.kind,
                UsageLedger.created_at,
            )
            .where(UsageLedger.created_at >= start, UsageLedger.created_at < end)
            .order_by(UsageLedger.created_at)
        )
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["created_at", "model", "user_id", "minutes", "cost", "kind"])
    for model_id, user_id, minutes, cost, kind, created_at in rows:
        writer.writerow([created_at.isoformat(), model_id, user_id, minutes, cost, kind])
    return PlainTextResponse(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=usage.csv"},
    )


# --------------------------------------------------------------------------
# queue and workers
# --------------------------------------------------------------------------

queue_router = APIRouter(tags=["admin-queue"], dependencies=[Depends(require_role("support"))])


@queue_router.get("/queue", summary="Queue per model")
async def queue_state(session: AsyncSession = Depends(get_session)) -> dict:
    models = (await session.scalars(select(Model).order_by(Model.name))).all()
    data = []
    for model in models:
        waiting = await session.scalar(
            select(func.count()).select_from(Job).where(
                Job.model_id == model.id, Job.status == "queued"
            )
        )
        running = await session.scalar(
            select(func.count()).select_from(Job).where(
                Job.model_id == model.id, Job.status == "running"
            )
        )
        oldest = await session.scalar(
            select(func.min(Job.created_at)).where(
                Job.model_id == model.id, Job.status == "queued"
            )
        )
        if oldest is not None and oldest.tzinfo is None:
            oldest = oldest.replace(tzinfo=UTC)
        longest_wait = (
            round((utcnow() - oldest).total_seconds() / 60, 1) if oldest else None
        )
        data.append(
            {
                "model": model.id,
                "name": model.name,
                "health_state": model.health_state,
                "queue_paused": model.queue_paused,
                "waiting": int(waiting or 0),
                "running": int(running or 0),
                "max_concurrent": model.max_concurrent,
                "longest_wait_minutes": longest_wait,
            }
        )
    return {"data": data}


@queue_router.get("/workers", summary="Worker heartbeats")
async def list_workers(session: AsyncSession = Depends(get_session)) -> dict:
    from dubber_center.services.workers import read_heartbeats

    return {"data": await read_heartbeats(session)}


class SweepIn(BaseModel):
    dry_run: bool = True


@queue_router.post("/jobs/sweep-stuck", summary="Sweep stuck jobs")
async def sweep_stuck(
    payload: SweepIn | None = None,
    request: Request = None,
    actor: RequireAdmin = None,
    session: AsyncSession = Depends(get_session),
    danger: Dangerous = Depends(Dangerous),
) -> dict:
    from dubber_center.worker.tasks import sweep_stuck_jobs

    dry_run = True if payload is None else payload.dry_run
    if not dry_run:
        danger.require_confirm()
    result = await sweep_stuck_jobs(session, dry_run=dry_run)
    if not dry_run:
        await write_audit(
            session, actor, "jobs.sweep", "job", None,
            after={"count": result["count"]},
            ip=request.client.host if request.client else None,
        )
        await session.commit()
    return result


# --------------------------------------------------------------------------
# settings and audit
# --------------------------------------------------------------------------

settings_router = APIRouter(tags=["admin-settings"], dependencies=[Depends(require_role("owner"))])


@settings_router.get("/settings", summary="All settings with defaults")
async def get_settings_endpoint(session: AsyncSession = Depends(get_session)) -> dict:
    values = await load_settings(session, force=True)
    return {
        "data": [
            {"key": k, "value": v, "default": SETTING_DEFAULTS.get(k)}
            for k, v in sorted(values.items())
        ]
    }


class SettingsIn(BaseModel):
    values: dict[str, Any]


@settings_router.put("/settings", summary="Update settings")
async def update_settings(
    payload: SettingsIn, request: Request, actor: RequireOwner,
    session: AsyncSession = Depends(get_session),
) -> dict:
    changes = await set_settings_bulk(session, payload.values, actor_id=actor.id)
    await write_audit(
        session, actor, "settings.update", "settings", None,
        before={k: v["before"] for k, v in changes.items()},
        after={k: v["after"] for k, v in changes.items()},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"updated": sorted(changes.keys())}


audit_router = APIRouter(tags=["admin-audit"], dependencies=[Depends(require_role("support"))])


@audit_router.get("/audit-log", summary="Audit log")
async def audit_log(
    session: AsyncSession = Depends(get_session),
    page: Page = Depends(Page),
    actor_id: str | None = Query(default=None, alias="actor"),
    action: str | None = None,
    target: str | None = None,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
) -> dict:
    conditions = []
    if actor_id:
        conditions.append(AuditLog.actor_user_id == actor_id)
    if action:
        conditions.append(AuditLog.action.like(f"%{action}%"))
    if target:
        conditions.append(AuditLog.target_id == target)
    if from_date:
        conditions.append(
            AuditLog.created_at >= datetime.fromisoformat(from_date).replace(tzinfo=UTC)
        )
    if to_date:
        conditions.append(
            AuditLog.created_at
            < datetime.fromisoformat(to_date).replace(tzinfo=UTC) + timedelta(days=1)
        )

    total = await session.scalar(select(func.count()).select_from(AuditLog).where(*conditions))
    rows = (
        await session.scalars(
            select(AuditLog).where(*conditions).order_by(AuditLog.created_at.desc())
            .offset(page.offset).limit(page.size)
        )
    ).all()
    return page.envelope(
        [
            {
                "id": a.id,
                "actor_user_id": a.actor_user_id,
                "action": a.action,
                "target_type": a.target_type,
                "target_id": a.target_id,
                "before": a.before,
                "after": a.after,
                "ip": a.ip,
                "created_at": a.created_at,
            }
            for a in rows
        ],
        int(total or 0),
    )
