"""API tests: catalog, auth, files, jobs (fake adapter), usage, cancel."""

from __future__ import annotations

import asyncio

import pytest


async def wait_for_job(client, headers, job_id, max_wait=15.0) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_wait
    while loop.time() < deadline:
        response = await client.get(f"/v1/jobs/{job_id}", headers=headers)
        body = response.json()
        if body["status"] in {"done", "failed", "canceled"}:
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish: {body}")


# --- catalog --------------------------------------------------------------


async def test_models_list(client):
    response = await client.get("/v1/models")
    assert response.status_code == 200
    body = response.json()
    ids = {m["id"] for m in body["data"]}
    assert {"paidv1", "localv1"}.issubset(ids)
    assert "en" in body["languages"]["source"]


async def test_model_detail_and_404(client):
    assert (await client.get("/v1/models/paidv1")).status_code == 200
    missing = await client.get("/v1/models/nope")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "model_not_found"


async def test_models_language_filter(client):
    response = await client.get("/v1/models", params={"target_lang": "km"})
    ids = {m["id"] for m in response.json()["data"]}
    assert "paidv1" in ids


# --- auth -----------------------------------------------------------------


async def test_requires_auth(client):
    response = await client.get("/v1/jobs")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


async def test_bad_key_rejected(client):
    response = await client.get("/v1/jobs", headers={"Authorization": "Bearer dk_live_nope"})
    assert response.status_code == 401


async def test_valid_key(client, auth):
    response = await client.get("/v1/jobs", headers=auth)
    assert response.status_code == 200
    assert response.json()["data"] == []


async def test_signup_login_me(client):
    signup = await client.post(
        "/v1/auth/signup", json={"email": "new@example.com", "password": "supersecret1"}
    )
    assert signup.status_code == 201
    me = await client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"

    client.cookies.clear()
    assert (await client.get("/v1/auth/me")).status_code == 401

    bad = await client.post(
        "/v1/auth/login", json={"email": "new@example.com", "password": "wrong"}
    )
    assert bad.status_code == 401

    good = await client.post(
        "/v1/auth/login", json={"email": "new@example.com", "password": "supersecret1"}
    )
    assert good.status_code == 200


async def test_duplicate_signup_conflicts(client):
    body = {"email": "dup@example.com", "password": "supersecret1"}
    assert (await client.post("/v1/auth/signup", json=body)).status_code == 201
    second = await client.post("/v1/auth/signup", json=body)
    assert second.status_code == 409


# --- files ----------------------------------------------------------------


async def test_file_presign_and_type_check(client, auth):
    ok = await client.post("/v1/files", headers=auth, json={"filename": "clip.mp4"})
    assert ok.status_code == 201
    body = ok.json()
    assert body["upload_url"]

    bad = await client.post("/v1/files", headers=auth, json={"filename": "virus.exe"})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "invalid_file_type"


# --- jobs -----------------------------------------------------------------

DUB = {
    "model": "fake",
    "video_url": "https://example.com/video.mp4",
    "source_lang": "en",
    "target_lang": "km",
    "minutes": 2,
}


async def test_create_and_finish_job(client, auth):
    created = await client.post("/v1/dub", headers=auth, json=DUB)
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "queued"
    assert body["model"] == "fake"

    final = await wait_for_job(client, auth, body["job_id"])
    assert final["status"] == "done"
    assert final["progress"] == 1.0
    assert final["output"]["video_url"]
    assert final["output"]["subtitles_url"]
    statuses = [event["status"] for event in final["events"]]
    assert statuses[0] == "queued"
    assert "running" in statuses
    assert statuses[-1] == "done"


async def test_unsupported_language(client, auth):
    response = await client.post(
        "/v1/dub",
        headers=auth,
        json={**DUB, "source_lang": "fr", "target_lang": "km"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "language_not_supported"


async def test_video_too_long(client, auth):
    response = await client.post(
        "/v1/dub", headers=auth, json={**DUB, "minutes": 999}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "video_too_long"


async def test_missing_video_source(client, auth):
    payload = {k: v for k, v in DUB.items() if k != "video_url"}
    response = await client.post("/v1/dub", headers=auth, json=payload)
    assert response.status_code == 422


async def test_idempotency_key(client, auth):
    headers = {**auth, "Idempotency-Key": "abc-123"}
    first = await client.post("/v1/dub", headers=headers, json=DUB)
    second = await client.post("/v1/dub", headers=headers, json=DUB)
    assert first.json()["job_id"] == second.json()["job_id"]


async def test_user_cannot_see_other_users_job(client, auth, session):
    from dubber_center.services.users import create_user_with_key

    _other, other_key = await create_user_with_key(
        session, email="other@example.com", credits=100
    )
    await session.close()
    created = await client.post("/v1/dub", headers=auth, json=DUB)
    job_id = created.json()["job_id"]

    response = await client.get(
        f"/v1/jobs/{job_id}", headers={"Authorization": f"Bearer {other_key}"}
    )
    assert response.status_code == 404


async def test_insufficient_credits(client, session):
    from dubber_center.services.users import create_user_with_key

    _broke, key = await create_user_with_key(session, email="broke@example.com", credits=0)
    response = await client.post(
        "/v1/dub", headers={"Authorization": f"Bearer {key}"}, json=DUB
    )
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "insufficient_credits"


async def test_cancel_queued_job(client, auth):
    created = await client.post(
        "/v1/dub", headers=auth, json={**DUB, "model": "localv1", "minutes": 1}
    )
    # localv1 is a cli runner with a nonexistent command; cancel immediately
    job_id = created.json()["job_id"]
    cancel = await client.post(f"/v1/jobs/{job_id}/cancel", headers=auth)
    assert cancel.status_code == 200
    final = await wait_for_job(client, auth, job_id)
    assert final["status"] in {"canceled", "failed"}


async def test_job_listing_and_pagination(client, auth):
    for _ in range(3):
        await client.post("/v1/dub", headers=auth, json=DUB)
    response = await client.get("/v1/jobs?page=1&size=2", headers=auth)
    body = response.json()
    assert body["total"] == 3
    assert len(body["data"]) == 2


async def test_usage_after_job(client, auth):
    created = await client.post("/v1/dub", headers=auth, json=DUB)
    await wait_for_job(client, auth, created.json()["job_id"])
    usage = await client.get("/v1/usage", headers=auth)
    assert usage.status_code == 200
    body = usage.json()
    assert body["total_jobs"] >= 1


async def test_credits_deducted_after_job(client, session, auth, user_and_key):
    """A priced job writes a ledger row and lowers the balance by the real cost."""
    from dubber_center.db.tables import Model, UsageLedger
    from dubber_center.registry.manifest import parse_manifest

    manifest = parse_manifest(
        {
            "id": "pricedfake",
            "name": "Priced Fake",
            "languages": {"source": ["en"], "target": ["km"]},
            "price_per_minute": 0.5,
            "runner": {
                "kind": "python",
                "python": {"class_path": "dubber_center.adapters.fake:FakeAdapter"},
            },
        }
    )
    session.add(Model(id="pricedfake", health_state="unknown", **{
        "name": manifest.name,
        "type": manifest.type,
        "status": "active",
        "manifest": manifest.model_dump(mode="json"),
        "price_per_minute": 0.5,
        "max_video_minutes": 60,
        "max_concurrent": 5,
    }))
    await session.commit()

    user, _key = user_and_key
    starting_balance = user.credits

    created = await client.post(
        "/v1/dub",
        headers=auth,
        json={**DUB, "model": "pricedfake", "minutes": 2},
    )
    assert created.json()["estimated_cost"] == 1.0
    final = await wait_for_job(client, auth, created.json()["job_id"])
    assert final["status"] == "done"
    assert final["cost"] == 1.0

    from sqlalchemy import select

    await session.refresh(user)
    assert user.credits == pytest.approx(starting_balance - 1.0)

    ledger = (
        await session.scalars(
            select(UsageLedger).where(UsageLedger.job_id == created.json()["job_id"])
        )
    ).all()
    assert len(ledger) == 1
    assert ledger[0].cost == 1.0
    assert ledger[0].kind == "user"


async def test_validation_envelope(client, auth):
    response = await client.post("/v1/dub", headers=auth, json={"model": "fake"})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_failed"
    assert any("source_lang" in f["field"] for f in body["error"]["details"]["fields"])