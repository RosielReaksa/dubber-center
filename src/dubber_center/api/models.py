"""Public model catalog endpoints (steps 3 and 23)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.db.base import get_session
from dubber_center.db.tables import Model
from dubber_center.registry.service import get_manifest, get_model, languages_map, list_models
from dubber_center.schemas.models import LanguageSet, ModelListOut, ModelOut

router = APIRouter(prefix="/models", tags=["models"])


def model_out(row: Model, *, languages: LanguageSet | None = None) -> ModelOut:
    manifest = row.manifest or {}
    langs = languages or LanguageSet(
        source=manifest.get("languages", {}).get("source", []),
        target=manifest.get("languages", {}).get("target", []),
    )
    return ModelOut(
        id=row.id,
        name=row.name,
        description=row.description,
        type=row.type,
        status=row.status,
        version=row.version,
        languages=langs,
        price_per_minute=row.price_per_minute,
        max_video_minutes=row.max_video_minutes,
        max_concurrent=row.max_concurrent,
        features=manifest.get("features", []),
        health_state=row.health_state,
        health_since=row.health_since,
        health_checked_at=row.health_checked_at,
    )


@router.get("", response_model=ModelListOut, summary="List dubbing models")
async def list_all_models(
    session: AsyncSession = Depends(get_session),
    type: str | None = Query(default=None, description="api | local | hybrid"),
    status: str | None = Query(default=None, description="active | beta | disabled"),
    source_lang: str | None = Query(default=None),
    target_lang: str | None = Query(default=None),
    healthy_only: bool = Query(default=False, description="Hide models whose health is down"),
    include_disabled: bool = Query(default=False),
) -> ModelListOut:
    rows = await list_models(session)

    filtered: list[Model] = []
    for row in rows:
        if not include_disabled and row.status == "disabled":
            continue
        if type and row.type != type:
            continue
        if status and row.status != status:
            continue
        if healthy_only and row.health_state == "down":
            continue
        manifest = row.manifest or {}
        langs = manifest.get("languages", {})
        if source_lang and source_lang.lower() not in langs.get("source", []):
            continue
        if target_lang and target_lang.lower() not in langs.get("target", []):
            continue
        filtered.append(row)

    return ModelListOut(
        data=[model_out(row) for row in filtered],
        total=len(filtered),
        languages=LanguageSet(**languages_map(rows)),
    )


@router.get("/{model_id}", response_model=ModelOut, summary="One model")
async def get_one_model(
    model_id: str,
    session: AsyncSession = Depends(get_session),
) -> ModelOut:
    row = await get_model(session, model_id)
    return model_out(row)


@router.get("/{model_id}/languages", summary="Model language matrix")
async def get_model_languages(
    model_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    manifest = await get_manifest(session, model_id)
    return {
        "model": manifest.id,
        "source": manifest.languages.source,
        "target": manifest.languages.target,
        "pairs": [
            {"source": src, "target": tgt}
            for src in manifest.languages.source
            for tgt in manifest.languages.target
        ],
    }