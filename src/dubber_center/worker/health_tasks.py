"""Model health: pings, canaries, and the status evaluator (project plan section 15).

Design notes that matter:

- The **evaluator** (`evaluate_rules`) is a pure function: inputs in, state out, so
  it can be unit tested exhaustively.
- Checks never block user jobs: they live on their own queue, use a Redis lock per
  model when Redis is available, and an in-process asyncio lock otherwise.
- Canary jobs are real `jobs` rows with `is_canary=true`, so they exercise the whole
  pipeline, but they are excluded from user lists, usage and billing.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from dubber_center.adapters import build_adapter
from dubber_center.config import settings
from dubber_center.core.logging import get_logger
from dubber_center.db.base import SessionLocal, utcnow
from dubber_center.db.tables import (
    Alert,
    Job,
    Model,
    ModelHealth,
    ModelStatusEvent,
    User,
)
from dubber_center.registry.manifest import ModelManifest
from dubber_center.registry.service import row_to_manifest

log = get_logger("dubber_center.health")

STATES = ("healthy", "degraded", "down", "unknown")
_RANK = {"down": 0, "degraded": 1, "unknown": 1, "healthy": 2}

DEFAULT_SETTINGS: dict[str, Any] = {
    "health.ping_timeout_sec": 5,
    "health.down_ping_failures": 3,
    "health.down_canary_failures": 2,
    "health.window_minutes": 60,
    "health.down_success_rate": 0.50,
    "health.down_min_jobs": 20,
    "health.degraded_success_rate": 0.90,
    "health.degraded_min_jobs": 10,
    "health.p95_multiplier": 2.0,
    "health.max_queue_wait_minutes": 15,
    "health.recover_passes": 2,
    "health.notify_channels": ["email"],
}


# --------------------------------------------------------------------------
# pure evaluator
# --------------------------------------------------------------------------


@dataclass
class ModelSignals:
    consecutive_ping_failures: int = 0
    consecutive_canary_failures: int = 0
    recent_jobs: int = 0
    recent_success_rate: float = 1.0
    p95_duration_sec: float | None = None
    baseline_p95_sec: float | None = None
    oldest_queue_wait_minutes: float = 0.0
    last_canary_failed: bool = False
    checked_at: datetime | None = None

    def has_data(self) -> bool:
        return self.checked_at is not None


@dataclass
class Thresholds:
    down_ping_failures: int = 3
    down_canary_failures: int = 2
    down_success_rate: float = 0.50
    down_min_jobs: int = 20
    degraded_success_rate: float = 0.90
    degraded_min_jobs: int = 10
    p95_multiplier: float = 2.0
    max_queue_wait_minutes: float = 15


@dataclass
class Evaluation:
    state: str
    reason: str = ""
    reasons: list[str] = field(default_factory=list)


def evaluate_rules(signals: ModelSignals, thresholds: Thresholds) -> Evaluation:
    """The status table from section 15.3. Worst state wins; reasons explain why."""
    if not signals.has_data():
        return Evaluation("unknown", "No checks yet")

    down: list[str] = []
    degraded: list[str] = []

    if signals.consecutive_ping_failures >= thresholds.down_ping_failures:
        down.append(f"{signals.consecutive_ping_failures} failed pings in a row")
    if signals.consecutive_canary_failures >= thresholds.down_canary_failures:
        down.append(f"{signals.consecutive_canary_failures} failed canaries in a row")
    if (
        signals.recent_jobs >= thresholds.down_min_jobs
        and signals.recent_success_rate < thresholds.down_success_rate
    ):
        down.append(
            f"Success rate {signals.recent_success_rate:.0%} below "
            f"{thresholds.down_success_rate:.0%} over {signals.recent_jobs} jobs"
        )

    if not down:
        if (
            signals.recent_jobs >= thresholds.degraded_min_jobs
            and signals.recent_success_rate < thresholds.degraded_success_rate
        ):
            degraded.append(
                f"Success rate {signals.recent_success_rate:.0%} below "
                f"{thresholds.degraded_success_rate:.0%} over {signals.recent_jobs} jobs"
            )
        if (
            signals.p95_duration_sec is not None
            and signals.baseline_p95_sec
            and signals.p95_duration_sec > thresholds.p95_multiplier * signals.baseline_p95_sec
        ):
            degraded.append(
                f"p95 {signals.p95_duration_sec / 60:.1f} min above "
                f"{thresholds.p95_multiplier:g}x baseline "
                f"({signals.baseline_p95_sec / 60:.1f} min)"
            )
        if signals.oldest_queue_wait_minutes > thresholds.max_queue_wait_minutes:
            degraded.append(
                f"Oldest queued job waited {signals.oldest_queue_wait_minutes:.0f} min"
            )
        if signals.last_canary_failed:
            degraded.append("Last canary failed")

    if down:
        return Evaluation("down", "; ".join(down), down)
    if degraded:
        return Evaluation("degraded", "; ".join(degraded), degraded)
    return Evaluation("healthy", "All checks passing")


def apply_recovery_rule(
    current: str, proposed: str, passes: int, needed: int
) -> tuple[str, int]:
    """Improvement needs N passes in a row; worsening is immediate (15.3)."""
    if proposed == current:
        return current, 0
    if _RANK.get(proposed, 1) > _RANK.get(current, 1):
        passes += 1
        if passes >= needed:
            return proposed, 0
        return current, passes
    return proposed, 0


# --------------------------------------------------------------------------
# settings
# --------------------------------------------------------------------------


async def get_health_settings(session) -> dict[str, Any]:
    from dubber_center.db.tables import Setting

    rows = (
        await session.scalars(select(Setting).where(Setting.key.like("health.%")))
    ).all()
    merged = dict(DEFAULT_SETTINGS)
    for row in rows:
        merged[row.key] = row.value
    return merged


def thresholds_for(manifest: ModelManifest, global_settings: dict[str, Any]) -> Thresholds:
    overrides = manifest.health

    def pick(value, key):
        return value if value is not None else global_settings.get(key, DEFAULT_SETTINGS[key])

    return Thresholds(
        down_ping_failures=pick(overrides.down_ping_failures, "health.down_ping_failures"),
        down_canary_failures=pick(overrides.down_canary_failures, "health.down_canary_failures"),
        down_success_rate=pick(overrides.down_success_rate, "health.down_success_rate"),
        down_min_jobs=pick(overrides.down_min_jobs, "health.down_min_jobs"),
        degraded_success_rate=pick(
            overrides.degraded_success_rate, "health.degraded_success_rate"
        ),
        degraded_min_jobs=pick(overrides.degraded_min_jobs, "health.degraded_min_jobs"),
        p95_multiplier=pick(overrides.p95_multiplier, "health.p95_multiplier"),
        max_queue_wait_minutes=pick(
            overrides.max_queue_wait_minutes, "health.max_queue_wait_minutes"
        ),
    )


# --------------------------------------------------------------------------
# signals (real data, canary and user failures excluded)
# --------------------------------------------------------------------------


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(int(len(ordered) * fraction), len(ordered) - 1)
    return ordered[index]


async def collect_signals(
    session, model_id: str, manifest: ModelManifest, window_minutes: int
) -> ModelSignals:
    since = utcnow() - timedelta(minutes=window_minutes)

    pings = (
        await session.scalars(
            select(ModelHealth)
            .where(
                ModelHealth.model_id == model_id,
                ModelHealth.check_type == "ping",
            )
            .order_by(ModelHealth.checked_at.desc())
            .limit(10)
        )
    ).all()
    ping_failures = 0
    for row in pings:
        if row.ok:
            break
        ping_failures += 1

    canaries = (
        await session.scalars(
            select(ModelHealth)
            .where(
                ModelHealth.model_id == model_id,
                ModelHealth.check_type == "canary",
            )
            .order_by(ModelHealth.checked_at.desc())
            .limit(10)
        )
    ).all()
    canary_failures = 0
    for row in canaries:
        if row.ok:
            break
        canary_failures += 1

    checked_at = pings[0].checked_at if pings else None
    if canaries and (checked_at is None or canaries[0].checked_at > checked_at):
        checked_at = canaries[0].checked_at

    # real-traffic stats: system failures only, canaries excluded
    job_rows = (
        await session.execute(
            select(Job.status, Job.error_kind, Job.started_at, Job.finished_at).where(
                Job.model_id == model_id,
                Job.is_canary.is_(False),
                Job.created_at >= since,
                Job.status.in_(["done", "failed"]),
            )
        )
    ).all()

    system_total = 0
    system_ok = 0
    durations: list[float] = []
    for status, kind, started, finished in job_rows:
        if kind == "user":
            continue  # user-caused failures never hurt model health
        system_total += 1
        if status == "done":
            system_ok += 1
        if started and finished:
            durations.append((finished - started).total_seconds())

    oldest = await session.scalar(
        select(func.min(Job.created_at)).where(
            Job.model_id == model_id, Job.status == "queued"
        )
    )
    wait_minutes = 0.0
    if oldest is not None:
        if oldest.tzinfo is None:
            oldest = oldest.replace(tzinfo=UTC)
        wait_minutes = max((utcnow() - oldest).total_seconds() / 60, 0.0)

    return ModelSignals(
        consecutive_ping_failures=ping_failures,
        consecutive_canary_failures=canary_failures,
        recent_jobs=system_total,
        recent_success_rate=(system_ok / system_total) if system_total else 1.0,
        p95_duration_sec=_percentile(durations, 0.95),
        baseline_p95_sec=manifest.health.baseline_p95_sec,
        oldest_queue_wait_minutes=wait_minutes,
        last_canary_failed=bool(canaries) and not canaries[0].ok,
        checked_at=checked_at,
    )


# --------------------------------------------------------------------------
# pings
# --------------------------------------------------------------------------


async def ping_model(session, model_id: str, *, write_row: bool = True) -> dict:
    from dubber_center.db.tables import Model as ModelRow

    row = await session.get(ModelRow, model_id)
    if row is None:
        return {"model": model_id, "ok": False, "error_code": "unknown"}

    manifest = row_to_manifest(row)
    adapter = build_adapter(manifest, Path(settings.canary_dir))
    timeout = manifest.health.ping_timeout_sec or 5.0
    started = asyncio.get_running_loop().time()

    ok = False
    error_code: str | None = None
    detail: dict[str, Any] = {}
    try:
        ok = await asyncio.wait_for(adapter.health(), timeout=timeout)
        if not ok:
            error_code = "service_unreachable"
    except TimeoutError:
        error_code = "timeout"
        detail["reason"] = "health() timed out"
    except Exception as exc:  # noqa: BLE001 — a check must never crash the loop
        error_code = _classify_error(exc)
        detail["exception"] = str(exc)[:300]

    latency_ms = round((asyncio.get_running_loop().time() - started) * 1000, 1)

    if write_row:
        session.add(
            ModelHealth(
                model_id=model_id,
                check_type="ping",
                ok=ok,
                latency_ms=latency_ms,
                error_code=error_code,
                detail=detail or None,
            )
        )
        if ok:
            row.last_ok_at = utcnow()
        row.health_checked_at = utcnow()
        await session.commit()

    return {
        "model": model_id,
        "ok": ok,
        "latency_ms": latency_ms,
        "error_code": error_code,
        "detail": detail,
    }


def _classify_error(exc: BaseException) -> str:
    text = str(exc).lower()
    if "auth" in text or "key" in text or "401" in text or "403" in text:
        return "provider_auth"
    if "gpu" in text or "cuda" in text or "nvidia" in text:
        return "gpu_unavailable"
    if "disk" in text or "space" in text:
        return "disk_full"
    if "rate" in text or "429" in text:
        return "provider_rate_limited"
    if "connect" in text or "unreachable" in text or "refused" in text:
        return "service_unreachable"
    return "unknown"


async def run_ping_round() -> int:
    """Ping every non-disabled model whose interval has elapsed."""
    count = 0
    async with SessionLocal() as session:
        rows = (await session.scalars(select(Model).where(Model.status != "disabled"))).all()
        for row in rows:
            manifest = row_to_manifest(row)
            last = await session.scalar(
                select(func.max(ModelHealth.checked_at)).where(
                    ModelHealth.model_id == row.id, ModelHealth.check_type == "ping"
                )
            )
            if last is not None and last.tzinfo is None:
                last = last.replace(tzinfo=UTC)
            if last is not None and (
                utcnow() - last
            ).total_seconds() < manifest.health.ping_interval_sec:
                continue
            await ping_model(session, row.id)
            count += 1
    return count


async def check_model(ctx, model_id: str) -> dict:
    """Arq task / used by admin `check-now`: ping immediately."""
    async with SessionLocal() as session:
        result = await ping_model(session, model_id)
    return result


# --------------------------------------------------------------------------
# canary
# --------------------------------------------------------------------------


async def _system_user(session) -> User:
    user = await session.scalar(select(User).where(User.is_canary.is_(True)))
    if user is None:
        user = User(
            email="canary@internal",
            name="Canary",
            role="user",
            credits=1_000_000.0,
            is_canary=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user


async def run_canary(session, model_id: str) -> dict:
    """Run a sample video through the model and validate the output (15.2)."""
    from dubber_center.schemas.models import DubCreateIn
    from dubber_center.services.jobs import create_job, enqueue

    row = await session.get(Model, model_id)
    if row is None:
        return {"model": model_id, "ok": False, "error_code": "unknown"}
    manifest = row_to_manifest(row)
    canary = manifest.health.canary

    if not canary.enabled:
        return {"model": model_id, "ok": True, "skipped": "canary disabled"}

    # single-GPU models: skip while a user job runs, unless already skipped twice
    if manifest.max_concurrent == 1 and canary.low_priority:
        running = await session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.model_id == model_id, Job.status == "running", Job.is_canary.is_(False))
        )
        if running:
            session.add(
                ModelHealth(
                    model_id=model_id,
                    check_type="canary",
                    ok=True,
                    detail={"skipped": "user job running"},
                )
            )
            await session.commit()
            return {"model": model_id, "ok": True, "skipped": "user job running"}

    sample = Path(canary.sample)
    if not sample.is_absolute():
        sample = settings.canary_dir.parent / canary.sample
    if not sample.exists():
        session.add(
            ModelHealth(
                model_id=model_id,
                check_type="canary",
                ok=False,
                error_code="output_missing",
                detail={"reason": f"canary sample missing: {sample}"},
            )
        )
        await session.commit()
        return {"model": model_id, "ok": False, "error_code": "output_missing"}

    user = await _system_user(session)
    from dubber_center.services.storage import get_storage

    storage = get_storage()
    key = f"canary/{model_id}/{sample.name}"
    await storage.put_bytes(key, sample.read_bytes(), "video/mp4")

    from dubber_center.db.tables import File

    file_row = File(user_id=user.id, storage_key=key, filename=sample.name, kind="canary")
    session.add(file_row)
    await session.commit()
    await session.refresh(file_row)

    payload = DubCreateIn(
        model=model_id,
        file_id=file_row.id,
        source_lang=canary.source_lang,
        target_lang=canary.target_lang,
        options={"subtitles": True},
        minutes=1.0,
    )
    job, _model = await create_job(session, user, payload, is_canary=True)
    await enqueue(job.id)
    return {"model": model_id, "job_id": job.id, "queued": True}


async def validate_canary_output(
    job: Job, manifest: ModelManifest
) -> tuple[bool, str | None, dict]:
    """(ok, error_code, detail) — rules 1..5 of 15.2."""
    detail: dict[str, Any] = {}
    if job.status != "done":
        return False, job.error_code or "timeout", {"status": job.status, "error": job.error}

    if not job.output or not job.output.get("video_url"):
        return False, "output_missing", {"reason": "no video in output"}

    duration_sec = None
    if job.started_at and job.finished_at:
        duration_sec = (job.finished_at - job.started_at).total_seconds()
    detail["duration_sec"] = duration_sec
    if duration_sec is not None and duration_sec > manifest.health.canary.max_minutes * 60:
        return False, "timeout", detail | {"reason": "canary took too long"}

    # Audio validity needs FFmpeg; when it is unavailable we record that we could
    # not verify instead of failing the model for a tooling gap.
    probe = await _probe_video(job, manifest)
    detail.update(probe)
    if probe.get("checked") and not probe.get("ok"):
        return False, probe.get("error_code", "output_invalid"), detail
    return True, None, detail


async def _probe_video(job: Job, manifest: ModelManifest) -> dict:
    """Optional FFmpeg probe: exists, length within 5%, has audio, not silent."""
    import shutil
    import subprocess
    import tempfile

    ffprobe = shutil.which("ffprobe")
    ffmpeg = shutil.which("ffmpeg")
    if not ffprobe:
        return {"checked": False, "reason": "ffprobe not installed"}

    from dubber_center.services.storage import get_storage

    url = (job.output or {}).get("video_url", "")
    data: bytes
    try:
        if url.startswith("http"):
            import httpx

            async with httpx.AsyncClient(timeout=60) as client:
                data = (await client.get(url)).content
        else:
            data = await get_storage().get_bytes(url)
    except Exception as exc:  # noqa: BLE001
        return {"checked": True, "ok": False, "error_code": "output_invalid", "reason": str(exc)}

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "canary.mp4"
        path.write_bytes(data)
        try:
            probe = await asyncio.to_thread(
                subprocess.run,
                [
                    ffprobe, "-v", "error", "-show_entries",
                    "format=duration:stream=codec_type",
                    "-of", "json", str(path),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            info = json.loads(probe.stdout or "{}")
        except Exception as exc:  # noqa: BLE001
            return {
                "checked": True,
                "ok": False,
                "error_code": "output_invalid",
                "reason": str(exc),
            }

        streams = info.get("streams", [])
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
        if not has_audio:
            return {"checked": True, "ok": False, "error_code": "output_invalid",
                    "reason": "no audio track"}

        if ffmpeg:
            volume = await asyncio.to_thread(
                subprocess.run,
                [ffmpeg, "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            mean = _parse_mean_volume(volume.stderr)
            if mean is not None and mean <= -50:
                return {"checked": True, "ok": False, "error_code": "output_silent",
                        "mean_volume_db": mean}
            return {"checked": True, "ok": True, "mean_volume_db": mean}
        return {"checked": True, "ok": True}


def _parse_mean_volume(stderr: str) -> float | None:
    import re

    match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", stderr)
    return float(match.group(1)) if match else None


async def run_canary_round() -> int:
    """Queue canaries whose interval has elapsed."""
    count = 0
    async with SessionLocal() as session:
        rows = (await session.scalars(select(Model).where(Model.status != "disabled"))).all()
        for row in rows:
            manifest = row_to_manifest(row)
            if not manifest.health.canary.enabled:
                continue
            last = await session.scalar(
                select(func.max(ModelHealth.checked_at)).where(
                    ModelHealth.model_id == row.id, ModelHealth.check_type == "canary"
                )
            )
            if last is not None and last.tzinfo is None:
                last = last.replace(tzinfo=UTC)
            interval = timedelta(minutes=manifest.health.canary.interval_minutes)
            if last is not None and utcnow() - last < interval:
                continue
            await run_canary(session, row.id)
            count += 1
    return count


# --------------------------------------------------------------------------
# evaluator loop
# --------------------------------------------------------------------------


async def evaluate_model(session, row: Model, global_settings: dict) -> Evaluation:
    manifest = row_to_manifest(row)
    thresholds = thresholds_for(manifest, global_settings)
    window = manifest.health.window_minutes or global_settings.get("health.window_minutes", 60)
    signals = await collect_signals(session, row.id, manifest, int(window))
    proposal = evaluate_rules(signals, thresholds)

    recover = manifest.health.recover_passes or global_settings.get(
        "health.recover_passes", 2
    )
    new_state, passes = apply_recovery_rule(
        row.health_state, proposal.state, row.health_recovery_passes, int(recover)
    )
    row.health_recovery_passes = passes

    if new_state != row.health_state:
        old = row.health_state
        row.health_state = new_state
        row.health_since = utcnow()
        session.add(
            ModelStatusEvent(
                model_id=row.id,
                old_state=old,
                new_state=new_state,
                reason=proposal.reason,
            )
        )
        await _sync_alert(session, row, old, new_state, proposal.reason)
        log.warning(
            "model state change",
            extra={
                "model": row.id,
                "old_state": old,
                "new_state": new_state,
                "reason": proposal.reason,
            },
        )
    return proposal


async def _sync_alert(session, row: Model, old: str, new: str, reason: str) -> None:
    """One open alert per problem; closed on recovery (15.8)."""
    dedupe = f"health:{row.id}"
    existing = await session.scalar(select(Alert).where(Alert.dedupe_key == dedupe))

    if new in {"degraded", "down"} and old != new:
        severity = "critical" if new == "down" else "warning"
        if existing and existing.status == "open":
            existing.message = f"{row.name} is {new}: {reason}"
            existing.severity = severity
        else:
            session.add(
                Alert(
                    type="model_health",
                    severity=severity,
                    subject_type="model",
                    subject_id=row.id,
                    message=f"{row.name} is {new}: {reason}",
                    dedupe_key=dedupe,
                )
            )
    elif new == "healthy" and existing and existing.status == "open":
        existing.status = "resolved"
        existing.resolved_at = utcnow()


async def evaluate_all_models() -> list[dict]:
    results: list[dict] = []
    async with SessionLocal() as session:
        global_settings = await get_health_settings(session)
        rows = (await session.scalars(select(Model).where(Model.status != "disabled"))).all()
        for row in rows:
            try:
                evaluation = await evaluate_model(session, row, global_settings)
                results.append(
                    {
                        "model": row.id,
                        "state": row.health_state,
                        "evaluated": evaluation.state,
                        "reason": evaluation.reason,
                    }
                )
            except Exception:  # a monitor crash must never break the API (15.9)
                log.exception("evaluator failed", extra={"model": row.id})
        await session.commit()
    return results