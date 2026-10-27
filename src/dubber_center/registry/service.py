"""Registry service: lookup, language checks, pricing, DB sync."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.config import settings
from dubber_center.core.errors import (
    LanguageNotSupported,
    ModelDisabled,
    ModelNotFound,
    ModelUnavailable,
    VideoTooLong,
)
from dubber_center.core.logging import get_logger
from dubber_center.db.tables import Model
from dubber_center.registry.manifest import (
    ManifestError,
    ModelManifest,
    load_manifests,
)

log = get_logger("dubber_center.registry")


# --- DB <-> manifest -----------------------------------------------------


def manifest_to_row(manifest: ModelManifest) -> dict:
    return {
        "name": manifest.name,
        "description": manifest.description,
        "type": manifest.type,
        "status": manifest.status,
        "version": manifest.version,
        "manifest": manifest.model_dump(mode="json"),
        "price_per_minute": manifest.price_per_minute,
        "max_video_minutes": manifest.max_video_minutes,
        "max_concurrent": manifest.max_concurrent,
    }


def row_to_manifest(row: Model) -> ModelManifest:
    return ModelManifest.model_validate(row.manifest)


async def sync_manifests(session: AsyncSession, models_dir=None) -> list[str]:
    """Upsert every manifest file into the models table. Returns warnings."""
    models_dir = models_dir or settings.models_dir
    manifests, errors = load_manifests(models_dir)

    existing = {row.id: row for row in (await session.scalars(select(Model))).all()}

    for manifest in manifests:
        row = existing.get(manifest.id)
        if row is None:
            row = Model(id=manifest.id, health_state="unknown", **manifest_to_row(manifest))
            session.add(row)
            log.info("model registered", extra={"model": manifest.id})
        else:
            for key, value in manifest_to_row(manifest).items():
                setattr(row, key, value)

    await session.commit()
    for error in errors:
        log.warning("manifest skipped", extra={"error": error})
    return errors


# --- lookup --------------------------------------------------------------


async def get_model(session: AsyncSession, model_id: str) -> Model:
    row = await session.get(Model, model_id)
    if row is None:
        raise ModelNotFound(f"Model '{model_id}' does not exist.")
    return row


async def list_models(session: AsyncSession) -> list[Model]:
    rows = await session.scalars(select(Model).order_by(Model.name))
    return list(rows.all())


async def get_manifest(session: AsyncSession, model_id: str) -> ModelManifest:
    return row_to_manifest(await get_model(session, model_id))


def supports(manifest: ModelManifest, source: str, target: str) -> bool:
    return manifest.supports(source, target)


def estimate_cost(manifest: ModelManifest, minutes: float) -> float:
    return manifest.estimate_cost(minutes)


def ensure_usable(row: Model, *, require_healthy: bool = False) -> None:
    """Configured status / health gates shared by job creation and auto routing."""
    if row.status == "disabled":
        raise ModelDisabled(f"Model '{row.id}' is disabled.")
    if row.health_state == "down":
        raise ModelUnavailable(f"Model '{row.id}' is unavailable right now.")


def ensure_request_ok(
    row: Model,
    manifest: ModelManifest,
    *,
    source_lang: str,
    target_lang: str,
    minutes: float | None = None,
) -> None:
    """All validation a new job needs, in the order users benefit from."""
    ensure_usable(row)

    if not manifest.supports(source_lang, target_lang):
        raise LanguageNotSupported(
            f"{manifest.id} does not support {source_lang} → {target_lang}.",
            details={
                "source_languages": manifest.languages.source,
                "target_languages": manifest.languages.target,
            },
        )

    if minutes is not None and minutes > manifest.max_video_minutes:
        raise VideoTooLong(
            f"The video is longer than {manifest.id} allows "
            f"({manifest.max_video_minutes:g} min). Choose a shorter video or another model.",
            details={"max_video_minutes": manifest.max_video_minutes, "minutes": minutes},
        )


def languages_map(rows: list[Model]) -> dict[str, dict[str, list[str]]]:
    """Union of all source/target languages across active models."""
    sources: set[str] = set()
    targets: set[str] = set()
    for row in rows:
        if row.status == "disabled":
            continue
        manifest = row_to_manifest(row)
        sources.update(manifest.languages.source)
        targets.update(manifest.languages.target)
    return {"source": sorted(sources), "target": sorted(targets)}


def utcnow() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "ManifestError",
    "ModelManifest",
    "ensure_request_ok",
    "ensure_usable",
    "estimate_cost",
    "get_manifest",
    "get_model",
    "languages_map",
    "list_models",
    "manifest_to_row",
    "row_to_manifest",
    "supports",
    "sync_manifests",
]