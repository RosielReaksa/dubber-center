"""Admin: model management (section 14.3, 6.8)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.admin.common import Dangerous, Page, RequireAdmin, write_audit
from dubber_center.api.deps import require_role
from dubber_center.core.errors import Conflict, NotFound, ValidationFailed
from dubber_center.db.base import get_session, utcnow
from dubber_center.db.tables import Job, Model, ModelHealth
from dubber_center.registry.manifest import ManifestError, ModelManifest, parse_manifest
from dubber_center.registry.service import manifest_to_row, row_to_manifest

router = APIRouter(tags=["admin"], dependencies=[Depends(require_role("support"))])

EDITABLE = [
    "name",
    "description",
    "type",
    "status",
    "version",
    "manifest",
    "price_per_minute",
    "max_video_minutes",
    "max_concurrent",
    "queue_paused",
]


class ManifestIn(BaseModel):
    """Either a YAML document, or the parsed mapping."""

    yaml: str | None = None
    manifest: dict[str, Any] | None = None


class ModelTestIn(BaseModel):
    source_lang: str | None = None
    target_lang: str | None = None


def _manifest_from(payload: ManifestIn) -> ModelManifest:
    import yaml as yaml_lib

    if payload.yaml:
        try:
            raw = yaml_lib.safe_load(payload.yaml)
        except yaml_lib.YAMLError as exc:
            raise ValidationFailed(f"Invalid YAML: {exc}") from exc
        if not isinstance(raw, dict):
            raise ValidationFailed("The manifest must be a YAML mapping.")
        return parse_manifest(raw, source="request")
    if payload.manifest:
        return parse_manifest(payload.manifest, source="request")
    raise ValidationFailed("Send either 'yaml' or 'manifest'.")


async def _model_health_counts(session: AsyncSession, model_id: str) -> dict:
    since = utcnow().replace(microsecond=0)
    from datetime import timedelta

    since = since - timedelta(hours=24)
    rows = (
        await session.execute(
            select(Job.status, Job.error_kind).where(
                Job.model_id == model_id,
                Job.is_canary.is_(False),
                Job.created_at >= since,
                Job.status.in_(["done", "failed"]),
            )
        )
    ).all()
    checked = [(status, kind) for status, kind in rows if kind != "user"]
    ok = sum(1 for status, _ in checked if status == "done")
    return {
        "success_rate_24h": round(ok / len(checked), 4) if checked else None,
        "jobs_24h": len(checked),
    }


@router.get("/models", summary="List models with health")
async def list_models(
    session: AsyncSession = Depends(get_session),
    page: Page = Depends(Page),
    q: str | None = None,
    health: str | None = Query(default=None, description="healthy|degraded|down|unknown"),
) -> dict:
    conditions = []
    if q:
        like = f"%{q.lower()}%"
        conditions.append(
            func.lower(Model.name).like(like) | func.lower(Model.id).like(like)
        )
    if health:
        conditions.append(Model.health_state == health)

    total = await session.scalar(select(func.count()).select_from(Model).where(*conditions))
    rows = (
        await session.scalars(
            select(Model)
            .where(*conditions)
            .order_by(Model.name)
            .offset(page.offset)
            .limit(page.size)
        )
    ).all()

    data = []
    for row in rows:
        stats = await _model_health_counts(session, row.id)
        data.append(
            {
                "id": row.id,
                "name": row.name,
                "type": row.type,
                "status": row.status,
                "health_state": row.health_state,
                "health_since": row.health_since,
                "health_checked_at": row.health_checked_at,
                "price_per_minute": row.price_per_minute,
                "max_concurrent": row.max_concurrent,
                "queue_paused": row.queue_paused,
                **stats,
            }
        )
    return page.envelope(data, int(total or 0))


@router.post("/models", status_code=201, summary="Register or update a model from a manifest")
async def register_model(
    payload: ManifestIn,
    request: Request,
    actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        manifest = _manifest_from(payload)
    except ManifestError as exc:
        raise ValidationFailed(str(exc)) from exc

    row = await session.get(Model, manifest.id)
    after = manifest_to_row(manifest)

    if row is None:
        row = Model(id=manifest.id, health_state="unknown", **after)
        session.add(row)
        action = "model.create"
        before = None
    else:
        before = {key: getattr(row, key) for key in EDITABLE}
        for key, value in after.items():
            setattr(row, key, value)
        action = "model.update"

    await write_audit(
        session, actor, action, "model", manifest.id, before=before, after=after,
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"id": manifest.id, "action": action}


@router.post("/models/validate-manifest", summary="Live manifest validation (no save)")
async def validate_manifest(payload: ManifestIn) -> dict:
    try:
        manifest = _manifest_from(payload)
    except (ManifestError, ValidationFailed) as exc:
        return {"valid": False, "errors": [str(exc)]}
    return {
        "valid": True,
        "errors": [],
        "preview": {
            **manifest.public_dict(),
            "runner_kind": manifest.runner.kind,
            "canary": manifest.health.canary.model_dump(),
        },
    }


@router.get("/models/{model_id}", summary="One model with manifest")
async def get_model_detail(
    model_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")
    last_ping = await session.scalar(
        select(ModelHealth)
        .where(ModelHealth.model_id == model_id, ModelHealth.check_type == "ping")
        .order_by(ModelHealth.checked_at.desc())
        .limit(1)
    )
    last_canary = await session.scalar(
        select(ModelHealth)
        .where(ModelHealth.model_id == model_id, ModelHealth.check_type == "canary")
        .order_by(ModelHealth.checked_at.desc())
        .limit(1)
    )
    return {
        "id": row.id,
        "name": row.name,
        "type": row.type,
        "status": row.status,
        "health_state": row.health_state,
        "health_since": row.health_since,
        "health_checked_at": row.health_checked_at,
        "queue_paused": row.queue_paused,
        "manifest": row.manifest,
        "last_ping": _check_dict(last_ping),
        "last_canary": _check_dict(last_canary),
    }


def _check_dict(row: ModelHealth | None) -> dict | None:
    if row is None:
        return None
    return {
        "ok": row.ok,
        "latency_ms": row.latency_ms,
        "error_code": row.error_code,
        "detail": row.detail,
        "checked_at": row.checked_at,
    }


@router.put("/models/{model_id}", summary="Update a model")
async def update_model(
    model_id: str,
    payload: ManifestIn,
    request: Request,
    actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")
    try:
        manifest = _manifest_from(payload)
    except ManifestError as exc:
        raise ValidationFailed(str(exc)) from exc
    if manifest.id != model_id:
        raise ValidationFailed("The manifest id must match the model being updated.")

    before = {key: getattr(row, key) for key in EDITABLE}
    for key, value in manifest_to_row(manifest).items():
        setattr(row, key, value)
    after = {key: getattr(row, key) for key in EDITABLE}

    await write_audit(
        session, actor, "model.update", "model", model_id, before=before, after=after,
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"id": model_id, "updated": True}


@router.post("/models/{model_id}/enable", summary="Enable a model")
async def enable_model(
    model_id: str, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await _set_status(session, actor, request, model_id, "active", "model.enable")


@router.post("/models/{model_id}/disable", summary="Disable a model (dry run aware)")
async def disable_model(
    model_id: str,
    request: Request,
    actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
    danger: Dangerous = Depends(Dangerous),
) -> dict:
    if danger.dry_run:
        return await _disable_impact(session, model_id)
    danger.require_confirm()
    return await _set_status(session, actor, request, model_id, "disabled", "model.disable")


async def _disable_impact(session: AsyncSession, model_id: str) -> dict:
    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")
    running = await session.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.model_id == model_id, Job.status == "running")
    )
    queued = await session.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.model_id == model_id, Job.status == "queued")
    )
    return {
        "dry_run": True,
        "model": model_id,
        "will_affect": {
            "running_jobs": int(running or 0),
            "queued_jobs": int(queued or 0),
        },
        "note": "Running jobs will finish; queued jobs will be rejected.",
    }


async def _set_status(
    session, actor, request: Request, model_id: str, status: str, action: str
) -> dict:
    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")
    if row.status == status:
        raise Conflict(f"Model is already {status}.")
    before = {"status": row.status}
    row.status = status
    await write_audit(
        session, actor, action, "model", model_id, before=before, after={"status": status},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"id": model_id, "status": status}


@router.post("/models/{model_id}/pause-queue", summary="Pause a model's queue")
async def pause_queue(
    model_id: str, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await _set_queue_paused(session, actor, request, model_id, True)


@router.post("/models/{model_id}/resume-queue", summary="Resume a model's queue")
async def resume_queue(
    model_id: str, request: Request, actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await _set_queue_paused(session, actor, request, model_id, False)


async def _set_queue_paused(session, actor, request, model_id: str, paused: bool) -> dict:
    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")
    before = {"queue_paused": row.queue_paused}
    row.queue_paused = paused
    await write_audit(
        session, actor, "model.pause_queue" if paused else "model.resume_queue",
        "model", model_id, before=before, after={"queue_paused": paused},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"id": model_id, "queue_paused": paused}


@router.post("/models/{model_id}/check-now", summary="Run a ping and canary now")
async def check_now(
    model_id: str,
    actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from dubber_center.worker.health_tasks import ping_model, run_canary

    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")

    ping = await ping_model(session, model_id)
    canary_result: dict
    try:
        canary_result = await run_canary(session, model_id)
    except Exception as exc:  # noqa: BLE001 — a failed check is data, not a 500
        canary_result = {"model": model_id, "ok": False, "error": str(exc)}
    return {"model": model_id, "ping": ping, "canary": canary_result}


@router.post("/models/{model_id}/test", summary="Run a small sample job")
async def test_model(
    model_id: str,
    payload: ModelTestIn,
    request: Request,
    actor: RequireAdmin,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from dubber_center.schemas.models import DubCreateIn
    from dubber_center.services.jobs import create_job, enqueue
    from dubber_center.worker.health_tasks import _system_user

    row = await session.get(Model, model_id)
    if row is None:
        raise NotFound("Model not found.")
    manifest = row_to_manifest(row)

    user = await _system_user(session)
    sample = manifest.health.canary
    payload_job = DubCreateIn(
        model=model_id,
        video_url="https://example.com/sample.mp4",
        source_lang=payload.source_lang
        or (manifest.languages.source[0] if manifest.languages.source else "en"),
        target_lang=payload.target_lang
        or (manifest.languages.target[0] if manifest.languages.target else "km"),
        minutes=canary_sample_minutes(sample),
    )
    job, _ = await create_job(session, user, payload_job, is_canary=True)
    await enqueue(job.id)
    await write_audit(
        session, actor, "model.test", "model", model_id, after={"job_id": job.id},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"model": model_id, "job_id": job.id, "status": job.status}


def canary_sample_minutes(sample) -> float:
    return min(sample.max_minutes, 5.0)