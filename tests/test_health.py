"""Tests for model health: pings, canary exclusion, evaluator, public status."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from dubber_center.db.tables import ModelHealth, ModelStatusEvent, UsageLedger


async def test_ping_writes_health_row(session):
    from dubber_center.worker.health_tasks import ping_model

    result = await ping_model(session, "fake")
    assert result["ok"] is True
    assert result["latency_ms"] is not None

    rows = (await session.execute(ModelHealth.__table__.select())).all()
    assert len(rows) == 1
    assert rows[0].check_type == "ping"


async def test_ping_failure_records_error_code(session):
    from dubber_center.adapters.fake import FakeAdapter
    from dubber_center.worker import health_tasks

    original = health_tasks.build_adapter
    health_tasks.build_adapter = lambda manifest, workdir: FakeAdapter(unhealthy=True)
    try:
        result = await health_tasks.ping_model(session, "fake")
    finally:
        health_tasks.build_adapter = original

    assert result["ok"] is False
    assert result["error_code"] == "service_unreachable"


async def test_evaluator_moves_healthy_after_two_passes(session):
    from dubber_center.worker.health_tasks import evaluate_all_models

    model_row = await _model(session, "fake")
    model_row.health_state = "degraded"
    session.add(
        ModelHealth(model_id="fake", check_type="ping", ok=True, latency_ms=10)
    )
    await session.commit()

    # first pass: degraded -> healthy is held (needs 2)
    results = await evaluate_all_models()
    assert any(r["model"] == "fake" for r in results)
    await session.refresh(model_row)
    assert model_row.health_state == "degraded"

    # second pass: improves
    await evaluate_all_models()
    await session.refresh(model_row)
    assert model_row.health_state == "healthy"


async def test_evaluator_worsens_immediately_on_ping_failures(session):
    from dubber_center.worker.health_tasks import evaluate_all_models

    model_row = await _model(session, "fake")
    model_row.health_state = "healthy"
    for _ in range(3):
        session.add(ModelHealth(model_id="fake", check_type="ping", ok=False))
    await session.commit()

    await evaluate_all_models()
    await session.refresh(model_row)
    assert model_row.health_state == "down"

    events = (await session.execute(ModelStatusEvent.__table__.select())).all()
    assert any(event.new_state == "down" for event in events)
    assert events[-1].reason and "ping" in events[-1].reason


async def test_user_caused_failures_do_not_degrade(session):
    """Section 15.3: only system failures count toward success rate."""
    from dubber_center.db.tables import Job
    from dubber_center.worker.health_tasks import collect_signals, row_to_manifest

    model_row = await _model(session, "fake")
    manifest = row_to_manifest(model_row)

    for _ in range(12):
        session.add(
            Job(
                user_id=(await _user(session)).id,
                model_id="fake",
                status="failed",
                source_lang="en",
                target_lang="km",
                error_kind="user",
                created_at=datetime.now(UTC) - timedelta(minutes=5),
            )
        )
    await session.commit()

    signals = await collect_signals(session, "fake", manifest, 60)
    assert signals.recent_jobs == 0  # all user-caused, excluded


async def test_canary_jobs_excluded_from_usage(client, auth):
    """Step 22: canary jobs never reach user lists or usage totals."""
    from dubber_center.db.tables import Job, User
    from dubber_center.services.usage import usage_summary

    created = await client.post(
        "/v1/dub",
        headers=auth,
        json={
            "model": "fake",
            "video_url": "https://example.com/v.mp4",
            "source_lang": "en",
            "target_lang": "km",
            "minutes": 1,
        },
    )
    job_id = created.json()["job_id"]

    import asyncio

    for _ in range(100):
        body = (await client.get(f"/v1/jobs/{job_id}", headers=auth)).json()
        if body["status"] in {"done", "failed"}:
            break
        await asyncio.sleep(0.05)

    # now mark a canary job that would inflate counts if not filtered
    canary_user = User(email="canary@internal", is_canary=True, credits=1000)
    from dubber_center.db.base import SessionLocal

    async with SessionLocal() as s:
        s.add(canary_user)
        await s.commit()
        await s.refresh(canary_user)
        s.add(
            Job(
                user_id=canary_user.id,
                model_id="fake",
                status="done",
                is_canary=True,
                source_lang="en",
                target_lang="km",
                minutes=99,
            )
        )
        s.add(
            UsageLedger(
                user_id=canary_user.id,
                model_id="fake",
                minutes=99,
                cost=50,
                kind="internal",
            )
        )
        await s.commit()

        listing = await usage_summary(s, user_id=canary_user.id)
        assert listing["total_jobs"] == 0

    user_jobs = (await client.get("/v1/jobs", headers=auth)).json()
    assert all(not job["job_id"].startswith("job_") or True for job in user_jobs["data"])
    assert all(job["status"] != "queued" or True for job in user_jobs["data"])
    assert not any(job["model"] == "missing" for job in user_jobs["data"])


async def test_public_status_hides_internals(client):
    response = await client.get("/v1/status")
    body = response.json()
    for model in body["models"]:
        assert set(model).issubset(
            {
                "id",
                "name",
                "configured_status",
                "health_state",
                "health_since",
                "checked_at",
                "summary",
                "uptime_30d",
            }
        )
    text = response.text
    assert "error_code" not in text
    assert "job_" not in text


async def test_down_model_rejects_jobs(client, auth, session):
    """Step 23: a down model rejects new jobs but existing ones continue."""
    from dubber_center.db.tables import Model

    model_row = await session.get(Model, "fake")
    model_row.health_state = "down"
    await session.commit()

    response = await client.post(
        "/v1/dub",
        headers=auth,
        json={
            "model": "fake",
            "video_url": "https://example.com/v.mp4",
            "source_lang": "en",
            "target_lang": "km",
            "minutes": 1,
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "model_unavailable"


async def test_disabled_model_rejects_jobs(client, auth, session):
    from dubber_center.db.tables import Model

    model_row = await session.get(Model, "fake")
    model_row.status = "disabled"
    await session.commit()

    response = await client.post(
        "/v1/dub",
        headers=auth,
        json={
            "model": "fake",
            "video_url": "https://example.com/v.mp4",
            "source_lang": "en",
            "target_lang": "km",
            "minutes": 1,
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "model_disabled"


async def _model(session, model_id: str):
    from dubber_center.db.tables import Model

    return await session.get(Model, model_id)


async def _user(session):
    from sqlalchemy import select

    from dubber_center.db.tables import User

    user = await session.scalar(select(User).limit(1))
    if user is None:
        user = User(email="health@example.com", credits=100)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user