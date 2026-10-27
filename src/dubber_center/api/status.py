"""Public status endpoints: GET /v1/status and /v1/models/{id}/status (section 15.7).

Public responses never include internal error details, hostnames or job IDs.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.db.base import get_session
from dubber_center.db.tables import Model, ModelStatusEvent
from dubber_center.registry.service import get_manifest, get_model
from dubber_center.services.stats import uptime_30d

router = APIRouter(tags=["status"])

_STATE_TEXT = {
    "healthy": "Working normally.",
    "degraded": "Slower or less reliable than usual.",
    "down": "Not accepting new jobs right now.",
    "unknown": "Not enough data yet.",
}


def _public_state(row: Model) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "configured_status": row.status,
        "health_state": row.health_state,
        "health_since": row.health_since,
        "checked_at": row.health_checked_at,
        "summary": _STATE_TEXT.get(row.health_state, ""),
    }


@router.get("/status", summary="Public status of all models")
async def public_status(session: AsyncSession = Depends(get_session)) -> dict:
    rows = (
        await session.scalars(select(Model).where(Model.status != "disabled").order_by(Model.name))
    ).all()

    models = []
    incidents = []
    for row in rows:
        uptime, _daily = await uptime_30d(session, row.id)
        models.append({**_public_state(row), "uptime_30d": uptime})
        if row.health_state in {"degraded", "down"}:
            incidents.append(
                {
                    "model": row.id,
                    "state": row.health_state,
                    "started_at": row.health_since,
                    "ended_at": None,
                    "summary": _STATE_TEXT.get(row.health_state, ""),
                }
            )

    return {
        "all_ok": not incidents,
        "incidents": incidents,
        "models": models,
    }


@router.get("/models/{model_id}/status", summary="Model health, uptime and incidents")
async def model_status(
    model_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = await get_model(session, model_id)
    await get_manifest(session, model_id)  # 404 if the manifest is unreadable

    uptime, daily = await uptime_30d(session, model_id)
    events = (
        await session.scalars(
            select(ModelStatusEvent)
            .where(ModelStatusEvent.model_id == model_id)
            .order_by(ModelStatusEvent.created_at.desc())
            .limit(20)
        )
    ).all()

    incidents = []
    for index, event in enumerate(events):
        ended = events[index - 1].created_at if index > 0 else None
        incidents.append(
            {
                "started_at": event.created_at,
                "ended_at": ended,
                "state": event.new_state,
                "summary": _STATE_TEXT.get(event.new_state, ""),
            }
        )

    return {
        "model": row.id,
        "name": row.name,
        "configured_status": row.status,
        "health_state": row.health_state,
        "health_since": row.health_since,
        "checked_at": row.health_checked_at,
        "uptime_30d": uptime,
        "daily": daily,
        "incidents": incidents,
    }