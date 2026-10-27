"""Admin: overview, timeseries and alerts (section 14.3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.api.admin.common import Page, RequireSupport, write_audit
from dubber_center.api.deps import require_role
from dubber_center.core.errors import NotFound
from dubber_center.db.base import get_session, utcnow
from dubber_center.db.tables import Alert, DailyStat, Job, Model, ModelHealth, User
from dubber_center.services.usage import revenue_totals

router = APIRouter(tags=["admin"], dependencies=[Depends(require_role("support"))])


def _window(days: int) -> tuple[datetime, datetime]:
    end = utcnow()
    start = end - timedelta(days=days)
    return start, end


def _naive_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo else value


@router.get("/overview", summary="Dashboard KPIs")
async def overview(
    session: AsyncSession = Depends(get_session),
    days: int = 1,
) -> dict:
    start, end = _window(days)

    jobs_total = await session.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.created_at >= start, Job.created_at <= end, Job.is_canary.is_(False))
    )
    jobs_done = await session.scalar(
        select(func.count())
        .select_from(Job)
        .where(
            Job.created_at >= start,
            Job.created_at <= end,
            Job.status == "done",
            Job.is_canary.is_(False),
        )
    )
    active = await session.scalar(
        select(func.count()).select_from(Job).where(Job.status == "running")
    )
    queued = await session.scalar(
        select(func.count()).select_from(Job).where(Job.status == "queued")
    )
    models_down = await session.scalar(
        select(func.count()).select_from(Model).where(Model.health_state == "down")
    )
    open_alerts = await session.scalar(
        select(func.count()).select_from(Alert).where(Alert.status == "open")
    )
    users_total = await session.scalar(select(func.count()).select_from(User))

    totals = await revenue_totals(session, start, end)

    health_rows = await session.execute(
        select(Model.id, Model.name, Model.health_state, Model.health_since).order_by(Model.name)
    )
    models = [
        {
            "id": model_id,
            "name": name,
            "health_state": state,
            "health_since": since,
        }
        for model_id, name, state, since in health_rows.all()
    ]

    recent_failures = (
        await session.execute(
            select(Job.id, Job.model_id, Job.error, Job.error_code, Job.created_at)
            .where(Job.status == "failed", Job.is_canary.is_(False))
            .order_by(Job.created_at.desc())
            .limit(10)
        )
    ).all()

    return {
        "window": {"from": start.isoformat(), "to": end.isoformat(), "days": days},
        "jobs_today": int(jobs_total or 0),
        "jobs_done": int(jobs_done or 0),
        "success_rate": round((jobs_done or 0) / jobs_total, 4) if jobs_total else None,
        "active_jobs": int(active or 0),
        "queue_length": int(queued or 0),
        "revenue": totals["revenue"],
        "cost": totals["cost"],
        "margin": round(totals["revenue"] - totals["cost"], 4),
        "models_down": int(models_down or 0),
        "open_alerts": int(open_alerts or 0),
        "users": int(users_total or 0),
        "models": models,
        "recent_failures": [
            {
                "job_id": job_id,
                "model": model_id,
                "error": error,
                "error_code": code,
                "created_at": created,
            }
            for job_id, model_id, error, code, created in recent_failures
        ],
        "needs_attention": await _needs_attention(session),
    }


async def _needs_attention(session: AsyncSession) -> list[dict]:
    items: list[dict] = []
    unhealthy = (
        await session.scalars(
            select(Model).where(Model.health_state.in_(["degraded", "down"]))
        )
    ).all()
    for model in unhealthy:
        items.append(
            {
                "type": "model_health",
                "model": model.id,
                "severity": "critical" if model.health_state == "down" else "warning",
                "message": f"{model.name} is {model.health_state}",
                "link": f"/admin/models/{model.id}",
            }
        )
    alerts = (
        await session.scalars(
            select(Alert).where(Alert.status == "open").order_by(Alert.created_at.desc()).limit(5)
        )
    ).all()
    for alert in alerts:
        items.append(
            {
                "type": alert.type,
                "model": alert.subject_id if alert.subject_type == "model" else None,
                "severity": alert.severity,
                "message": alert.message,
                "link": "/admin/alerts",
            }
        )
    return items


@router.get("/stats/timeseries", summary="Chart data")
async def timeseries(
    session: AsyncSession = Depends(get_session),
    metric: str = "jobs",
    group_by: str = "day",
    from_date: str | None = None,
    to_date: str | None = None,
    days: int = 30,
) -> dict:
    start, end = _window(max(1, days))
    if from_date:
        start = datetime.fromisoformat(from_date).replace(tzinfo=UTC)
    if to_date:
        end = datetime.fromisoformat(to_date).replace(tzinfo=UTC) + timedelta(days=1)

    if metric not in {"jobs", "revenue", "cost", "minutes"}:
        from dubber_center.core.errors import ValidationFailed

        raise ValidationFailed("metric must be one of: jobs, revenue, cost, minutes")
    if group_by not in {"day", "model"}:
        from dubber_center.core.errors import ValidationFailed

        raise ValidationFailed("group_by must be 'day' or 'model'")

    rows = (
        await session.scalars(
            select(DailyStat).where(
                DailyStat.date >= start.date(), DailyStat.date <= end.date()
            )
        )
    ).all()

    buckets: dict[str, float] = {}
    for row in rows:
        key = row.date.isoformat() if group_by == "day" else row.model_id
        if metric == "jobs":
            value = row.jobs_done
        elif metric == "revenue":
            value = row.revenue
        elif metric == "cost":
            value = row.cost
        else:
            value = row.minutes
        buckets[key] = buckets.get(key, 0.0) + value

    return {
        "metric": metric,
        "group_by": group_by,
        "points": [
            {"key": key, "value": round(value, 4)}
            for key, value in sorted(buckets.items())
        ],
    }


@router.get("/alerts", summary="List alerts")
async def list_alerts(
    session: AsyncSession = Depends(get_session),
    status: str | None = None,
    page: Page = Depends(Page),
) -> dict:
    conditions = [] if status in {None, "all"} else [Alert.status == status]
    total = await session.scalar(select(func.count()).select_from(Alert).where(*conditions))
    rows = (
        await session.scalars(
            select(Alert)
            .where(*conditions)
            .order_by(Alert.created_at.desc())
            .offset(page.offset)
            .limit(page.size)
        )
    ).all()
    return page.envelope(
        [
            {
                "id": a.id,
                "type": a.type,
                "severity": a.severity,
                "subject_type": a.subject_type,
                "subject_id": a.subject_id,
                "message": a.message,
                "status": a.status,
                "created_at": a.created_at,
                "resolved_at": a.resolved_at,
            }
            for a in rows
        ],
        int(total or 0),
    )


@router.post("/alerts/{alert_id}/resolve", summary="Resolve an alert")
async def resolve_alert(
    alert_id: int,
    request: Request,
    actor: RequireSupport,
    session: AsyncSession = Depends(get_session),
) -> dict:
    alert = await session.get(Alert, alert_id)
    if alert is None:
        raise NotFound("Alert not found.")
    before = {"status": alert.status}
    alert.status = "resolved"
    alert.resolved_at = utcnow()
    await write_audit(
        session,
        actor,
        "alert.resolve",
        "alert",
        str(alert.id),
        before=before,
        after={"status": "resolved"},
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return {"id": alert.id, "status": alert.status}


@router.get("/models/{model_id}/health-history", summary="Check log and state changes")
async def health_history(
    model_id: str,
    session: AsyncSession = Depends(get_session),
    type: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 200,
) -> dict:
    from dubber_center.db.tables import ModelStatusEvent

    conditions = [ModelHealth.model_id == model_id]
    if type:
        conditions.append(ModelHealth.check_type == type)
    checks = (
        await session.scalars(
            select(ModelHealth)
            .where(*conditions)
            .order_by(ModelHealth.checked_at.desc())
            .limit(limit)
        )
    ).all()
    events = (
        await session.scalars(
            select(ModelStatusEvent)
            .where(ModelStatusEvent.model_id == model_id)
            .order_by(ModelStatusEvent.created_at.desc())
            .limit(limit)
        )
    ).all()
    return {
        "model": model_id,
        "checks": [
            {
                "type": c.check_type,
                "ok": c.ok,
                "latency_ms": c.latency_ms,
                "error_code": c.error_code,
                "detail": c.detail,
                "checked_at": c.checked_at,
            }
            for c in checks
        ],
        "state_changes": [
            {
                "old_state": e.old_state,
                "new_state": e.new_state,
                "reason": e.reason,
                "created_at": e.created_at,
            }
            for e in events
        ],
    }