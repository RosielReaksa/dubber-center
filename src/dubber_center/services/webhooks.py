"""Signed webhook delivery with retries (project plan step 10)."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dubber_center.config import settings
from dubber_center.core.logging import get_logger
from dubber_center.core.security import sign_payload
from dubber_center.db.tables import Job, WebhookDelivery

log = get_logger("dubber_center.webhooks")

MAX_ATTEMPTS = 4
_TIMEOUT = 15.0


def build_payload(job: Job) -> dict:
    return {
        "event": f"job.{job.status}",
        "job_id": job.id,
        "status": job.status,
        "model": job.model_id,
        "source_lang": job.source_lang,
        "target_lang": job.target_lang,
        "progress": job.progress,
        "output": job.output,
        "cost": job.cost,
        "error": job.error,
        "error_code": job.error_code,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


async def deliver_for_job(session: AsyncSession, job: Job) -> None:
    if not job.webhook_url:
        return
    payload = build_payload(job)
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = sign_payload(settings.webhook_secret, body)
    headers = {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Dubber-Event": f"job.{job.status}",
        "X-Dubber-Job": job.id,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            status_code: int | None = None
            error: str | None = None
            try:
                response = await client.post(job.webhook_url, content=body, headers=headers)
                status_code = response.status_code
                ok = 200 <= response.status_code < 300
                if not ok:
                    error = f"HTTP {response.status_code}"
            except httpx.HTTPError as exc:
                ok = False
                error = str(exc)

            session.add(
                WebhookDelivery(
                    job_id=job.id,
                    url=job.webhook_url,
                    status_code=status_code,
                    attempt=attempt,
                    ok=ok,
                    error=error,
                )
            )
            await session.commit()

            if ok:
                log.info("webhook delivered", extra={"job_id": job.id, "attempt": attempt})
                return

            log.warning(
                "webhook failed",
                extra={"job_id": job.id, "attempt": attempt, "error": error},
            )
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(min(2 ** attempt, 30))


async def recent_deliveries(session: AsyncSession, job_id: str) -> list[dict]:
    rows = (
        await session.scalars(
            select(WebhookDelivery)
            .where(WebhookDelivery.job_id == job_id)
            .order_by(WebhookDelivery.created_at)
        )
    ).all()
    return [
        {
            "attempt": r.attempt,
            "url": r.url,
            "status_code": r.status_code,
            "ok": r.ok,
            "error": r.error,
            "created_at": (r.created_at or datetime.now(UTC)).isoformat(),
        }
        for r in rows
    ]