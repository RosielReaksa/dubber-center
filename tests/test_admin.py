"""Admin tests: role matrix, audit rows, dry-run vs confirm, no secrets leaked."""

from __future__ import annotations

import pytest

ADMIN_ROUTES_READ = [
    ("get", "/v1/admin/overview"),
    ("get", "/v1/admin/models"),
    ("get", "/v1/admin/jobs"),
    ("get", "/v1/admin/users"),
    ("get", "/v1/admin/usage"),
    ("get", "/v1/admin/queue"),
    ("get", "/v1/admin/workers"),
    ("get", "/v1/admin/alerts"),
    ("get", "/v1/admin/audit-log"),
]


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES_READ)
async def test_support_can_read(method, path, client, support_auth):
    response = await getattr(client, method)(path, headers=support_auth)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES_READ)
async def test_plain_user_is_forbidden(method, path, client, auth):
    response = await getattr(client, method)(path, headers=auth)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES_READ)
async def test_anonymous_is_rejected(method, path, client):
    response = await getattr(client, method)(path)
    assert response.status_code == 401


async def test_support_cannot_manage_models(client, support_auth):
    response = await client.post(
        "/v1/admin/models/fake/disable?confirm=true", headers=support_auth
    )
    assert response.status_code == 403


async def test_support_cannot_manage_users(client, support_auth):
    response = await client.post(
        "/v1/admin/users",
        headers=support_auth,
        json={"email": "x@example.com"},
    )
    assert response.status_code == 403


async def test_admin_cannot_change_settings(client, admin_auth):
    response = await client.put(
        "/v1/admin/settings", headers=admin_auth, json={"values": {}}
    )
    assert response.status_code == 403


async def test_owner_can_change_settings(client, owner_auth):
    response = await client.put(
        "/v1/admin/settings",
        headers=owner_auth,
        json={"values": {"health.down_min_jobs": 15}},
    )
    assert response.status_code == 200
    assert "health.down_min_jobs" in response.json()["updated"]


# --- audit ----------------------------------------------------------------


async def test_admin_write_creates_audit_row(client, admin_auth, session):
    from sqlalchemy import select

    from dubber_center.db.tables import AuditLog

    response = await client.post(
        "/v1/admin/users",
        headers=admin_auth,
        json={"email": "audited@example.com", "credits": 5.0},
    )
    assert response.status_code == 201

    rows = (await session.scalars(select(AuditLog).where(AuditLog.action == "user.create"))).all()
    assert len(rows) == 1
    assert rows[0].actor_user_id
    assert rows[0].after["email"] == "audited@example.com"


async def test_model_update_audits_before_and_after(client, admin_auth, session):
    from sqlalchemy import select

    from dubber_center.db.tables import AuditLog

    manifest = {
        "id": "fake",
        "name": "Fake Renamed",
        "languages": {"source": ["en"], "target": ["km"]},
        "price_per_minute": 0.1,
        "runner": {
            "kind": "python",
            "python": {"class_path": "dubber_center.adapters.fake:FakeAdapter"},
        },
    }
    response = await client.put(
        "/v1/admin/models/fake", headers=admin_auth, json={"manifest": manifest}
    )
    assert response.status_code == 200

    row = await session.scalar(
        select(AuditLog).where(AuditLog.action == "model.update").order_by(AuditLog.id.desc())
    )
    assert row is not None
    assert row.before["name"] == "Fake (test)"
    assert row.after["name"] == "Fake Renamed"


# --- dry run / confirm ----------------------------------------------------


async def test_disable_requires_confirmation(client, admin_auth):
    response = await client.post("/v1/admin/models/fake/disable", headers=admin_auth)
    assert response.status_code == 422
    assert "confirm" in response.json()["error"]["message"]


async def test_disable_dry_run_reports_impact(client, admin_auth):
    response = await client.post(
        "/v1/admin/models/fake/disable?dry_run=true", headers=admin_auth
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert "running_jobs" in body["will_affect"]
    assert "queued_jobs" in body["will_affect"]


async def test_disable_with_confirm(client, admin_auth):
    response = await client.post(
        "/v1/admin/models/fake/disable?confirm=true", headers=admin_auth
    )
    assert response.status_code == 200
    assert response.json()["status"] == "disabled"

    # disabled models disappear from the public catalog and reject new jobs
    listing = await client.get("/v1/models")
    assert "fake" not in {m["id"] for m in listing.json()["data"]}

    enable = await client.post("/v1/admin/models/fake/enable", headers=admin_auth)
    assert enable.status_code == 200


async def test_key_revoke_dry_run_then_confirm(client, admin_auth, session):
    created = await client.post(
        "/v1/admin/users", headers=admin_auth, json={"email": "k@example.com"}
    )
    user_id = created.json()["id"]
    keys = await client.get(f"/v1/admin/users/{user_id}/keys", headers=admin_auth)
    key_id = keys.json()["data"][0]["id"]

    needs_confirm = await client.delete(f"/v1/admin/keys/{key_id}", headers=admin_auth)
    assert needs_confirm.status_code == 422

    dry = await client.delete(f"/v1/admin/keys/{key_id}?dry_run=true", headers=admin_auth)
    assert dry.status_code == 200
    assert dry.json()["dry_run"] is True

    real = await client.delete(f"/v1/admin/keys/{key_id}?confirm=true", headers=admin_auth)
    assert real.status_code == 200
    assert real.json()["revoked_at"]


# --- secrets --------------------------------------------------------------


async def test_key_creation_returns_raw_key_once(client, admin_auth):
    created = await client.post(
        "/v1/admin/users", headers=admin_auth, json={"email": "secret@example.com"}
    )
    body = created.json()
    assert body["api_key"].startswith("dk_live_")
    assert body["key_prefix"].startswith("dk_live_")

    user_id = body["id"]
    listing = await client.get(f"/v1/admin/users/{user_id}/keys", headers=admin_auth)
    text = listing.text
    assert body["api_key"] not in text
    assert "key_hash" not in text
    assert "dk_live_" in text  # prefixes are fine


async def test_overview_has_no_internals(client, support_auth):
    response = await client.get("/v1/admin/overview", headers=support_auth)
    text = response.text
    assert "postgres" not in text.lower()
    assert "paid-system.internal" not in text


# --- credits --------------------------------------------------------------


async def test_credits_go_through_the_ledger(client, admin_auth, session):
    from sqlalchemy import select

    from dubber_center.db.tables import CreditTransaction

    created = await client.post(
        "/v1/admin/users", headers=admin_auth, json={"email": "credit@example.com"}
    )
    user_id = created.json()["id"]

    response = await client.post(
        f"/v1/admin/users/{user_id}/credits",
        headers=admin_auth,
        json={"amount": 25.0, "reason": "support top-up"},
    )
    assert response.status_code == 200
    assert response.json()["balance"] == 25.0

    rows = (
        await session.scalars(
            select(CreditTransaction).where(CreditTransaction.user_id == user_id)
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].amount == 25.0
    assert rows[0].reason == "support top-up"


async def test_credits_reason_required(client, admin_auth):
    created = await client.post(
        "/v1/admin/users", headers=admin_auth, json={"email": "noreason@example.com"}
    )
    user_id = created.json()["id"]
    response = await client.post(
        f"/v1/admin/users/{user_id}/credits",
        headers=admin_auth,
        json={"amount": 10.0},
    )
    assert response.status_code == 422


# --- manifest validation --------------------------------------------------


async def test_validate_manifest_ok(client, admin_auth):
    yaml_text = """
id: prev1
name: Preview V1
languages: {source: [en], target: [km]}
runner:
  kind: python
  python: {class_path: "dubber_center.adapters.fake:FakeAdapter"}
"""
    response = await client.post(
        "/v1/admin/models/validate-manifest", headers=admin_auth, json={"yaml": yaml_text}
    )
    body = response.json()
    assert body["valid"] is True
    assert body["preview"]["id"] == "prev1"
    assert "runner" not in body["preview"]


async def test_validate_manifest_rejects_bad_yaml(client, admin_auth):
    response = await client.post(
        "/v1/admin/models/validate-manifest",
        headers=admin_auth,
        json={"yaml": "id: [unclosed"},
    )
    body = response.json()
    assert body["valid"] is False
    assert body["errors"]


# --- queue ----------------------------------------------------------------


async def test_pause_and_resume_queue(client, admin_auth):
    pause = await client.post("/v1/admin/models/fake/pause-queue", headers=admin_auth)
    assert pause.status_code == 200
    queue = await client.get("/v1/admin/queue", headers=admin_auth)
    fake = next(m for m in queue.json()["data"] if m["model"] == "fake")
    assert fake["queue_paused"] is True

    resume = await client.post("/v1/admin/models/fake/resume-queue", headers=admin_auth)
    assert resume.status_code == 200


async def test_sweep_stuck_dry_run_default(client, admin_auth):
    response = await client.post("/v1/admin/jobs/sweep-stuck", headers=admin_auth)
    assert response.status_code == 200
    assert response.json()["dry_run"] is True
    assert response.json()["count"] == 0


# --- public status --------------------------------------------------------


async def test_public_status_no_auth(client):
    response = await client.get("/v1/status")
    assert response.status_code == 200
    body = response.json()
    assert "models" in body
    assert "all_ok" in body
    for model in body["models"]:
        assert "error_code" not in model
        assert "hostname" not in model


async def test_model_status_endpoint(client):
    response = await client.get("/v1/models/paidv1/status")
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "paidv1"
    assert "daily" in body
    assert "incidents" in body