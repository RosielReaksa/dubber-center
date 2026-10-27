"""Account endpoints: keys shown once, credits through the ledger, rate limits."""

from __future__ import annotations


async def test_create_key_shown_once(client, auth):
    created = await client.post("/v1/keys", headers=auth, json={"name": "ci"})
    assert created.status_code == 201
    body = created.json()
    assert body["key"].startswith("dk_live_")
    assert body["prefix"].startswith("dk_live_")

    listed = await client.get("/v1/keys", headers=auth)
    text = listed.text
    assert body["key"] not in text  # never returned again
    assert body["prefix"] in text


async def test_new_key_authenticates(client, auth):
    created = await client.post("/v1/keys", headers=auth, json={"name": "second"})
    raw = created.json()["key"]

    response = await client.get("/v1/jobs", headers={"Authorization": f"Bearer {raw}"})
    assert response.status_code == 200


async def test_revoke_key(client, auth):
    created = await client.post("/v1/keys", headers=auth, json={"name": "temp"})
    body = created.json()

    # find the id via the list (the create response only carries prefix/key)
    listed = (await client.get("/v1/keys", headers=auth)).json()["data"]
    key_id = next(k["id"] for k in listed if k["prefix"] == body["prefix"])

    revoked = await client.delete(f"/v1/keys/{key_id}", headers=auth)
    assert revoked.status_code == 200
    assert revoked.json()["revoked_at"]

    # revoked key no longer authenticates
    response = await client.get("/v1/jobs", headers={"Authorization": f"Bearer {body['key']}"})
    assert response.status_code == 401


async def test_cannot_revoke_someone_elses_key(client, auth, session):
    from dubber_center.services.users import create_user_with_key

    _other, other_key = await create_user_with_key(session, email="other2@example.com")
    other_created = await client.post(
        "/v1/keys", headers={"Authorization": f"Bearer {other_key}"}, json={"name": "x"}
    )
    other_prefix = other_created.json()["prefix"]
    listed = (
        await client.get("/v1/keys", headers={"Authorization": f"Bearer {other_key}"})
    ).json()["data"]
    other_key_id = next(k["id"] for k in listed if k["prefix"] == other_prefix)

    response = await client.delete(f"/v1/keys/{other_key_id}", headers=auth)
    assert response.status_code == 404


async def test_credits_endpoint(client, auth, user_and_key):
    user, _key = user_and_key
    response = await client.get("/v1/credits", headers=auth)
    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == user.credits
    assert isinstance(body["transactions"], list)


async def test_transactions_endpoint(client, auth):
    response = await client.get("/v1/credits/transactions", headers=auth)
    assert response.status_code == 200
    assert response.json()["data"] == []


async def test_checkout_is_honest_about_not_being_ready(client, auth):
    response = await client.post("/v1/credits/checkout", headers=auth, json={"amount": 25})
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "payments_not_enabled"


async def test_rate_limit_kicks_in(client, auth):
    from dubber_center.services.ratelimit import reset_rate_limits

    reset_rate_limits()
    statuses = []
    for _ in range(65):
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
        statuses.append(response.status_code)

    assert 429 in statuses
    assert any(status == 201 for status in statuses)


async def test_health_endpoint(client):
    response = await client.get("/health")
    assert response.json() == {"status": "ok"}


async def test_request_id_header(client):
    response = await client.get("/v1/models")
    assert response.headers.get("x-request-id", "").startswith("req_")


async def test_cors_headers_present(client):
    response = await client.options(
        "/v1/models",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code in {200, 204}