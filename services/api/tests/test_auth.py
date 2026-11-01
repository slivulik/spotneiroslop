import re
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select, update

from sonora_api.models import RefreshToken, User
from sonora_api.services.google import GoogleIdentity
from tests.conftest import DEVICE, Harness, bearer, register


def _token_from_mail(harness: Harness, path: str) -> str:
    body = harness.email.outbox[-1].get_content()
    match = re.search(rf"{path}\?token=([\w-]+)", body)
    assert match, body
    return match.group(1)


async def test_register_returns_tokens_and_sends_verification(harness: Harness) -> None:
    tokens = await register(harness.client, email="New.User@Example.com")
    assert tokens["token_type"] == "Bearer"
    assert tokens["user"]["email"] == "new.user@example.com"
    assert tokens["user"]["email_verified"] is False
    assert tokens["user"]["has_password"] is True
    assert harness.email.outbox[-1]["To"] == "new.user@example.com"

    me = await harness.client.get("/v1/me", headers=bearer(tokens))
    assert me.status_code == 200
    assert me.json()["display_name"] == "Listener"


async def test_register_duplicate_email_is_conflict(client: AsyncClient) -> None:
    await register(client)
    response = await client.post(
        "/v1/auth/register",
        json={
            "email": "LISTENER@example.com",
            "password": "another password",
            "display_name": "x",
            "device": DEVICE,
        },
    )
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "email_taken"
    assert error["request_id"] == response.headers["x-request-id"]


async def test_register_validates_password(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/auth/register",
        json={"email": "a@example.com", "password": "aaaaaaaaaa", "display_name": "x", "device": DEVICE},
    )
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert body["details"]["fields"][0]["loc"][-1] == "password"


async def test_login_success_and_failure_are_indistinguishable(client: AsyncClient) -> None:
    await register(client)
    ok = await client.post(
        "/v1/auth/login",
        json={"email": "listener@example.com", "password": "correct horse battery", "device": DEVICE},
    )
    assert ok.status_code == 200
    wrong_password = await client.post(
        "/v1/auth/login", json={"email": "listener@example.com", "password": "nope", "device": DEVICE}
    )
    unknown_user = await client.post(
        "/v1/auth/login", json={"email": "ghost@example.com", "password": "nope", "device": DEVICE}
    )
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert (
        wrong_password.json()["error"]["code"]
        == unknown_user.json()["error"]["code"]
        == "invalid_credentials"
    )


async def test_refresh_rotates_and_detects_reuse(harness: Harness) -> None:
    client = harness.client
    first = await register(client)
    second = (await client.post("/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})).json()
    assert second["refresh_token"] != first["refresh_token"]
    assert second["device_id"] == first["device_id"]

    # Immediate replay of the rotated token: benign race, no family revocation.
    race = await client.post("/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert race.status_code == 401
    assert race.json()["error"]["code"] == "refresh_token_rotated"
    third = await client.post("/v1/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert third.status_code == 200

    # Replay after the grace window: treated as theft, whole family dies.
    async with harness.ctx.sessionmaker() as s:
        await s.execute(
            update(RefreshToken)
            .values(revoked_at=RefreshToken.revoked_at - timedelta(minutes=5))
            .where(RefreshToken.revoked_at.is_not(None))
        )
        await s.commit()
    theft = await client.post("/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert theft.json()["error"]["code"] == "invalid_refresh_token"
    latest = await client.post("/v1/auth/refresh", json={"refresh_token": third.json()["refresh_token"]})
    assert latest.status_code == 401
    # The access token of that device is cut off immediately as well.
    me = await client.get("/v1/me", headers=bearer(third.json()))
    assert me.json()["error"]["code"] == "session_revoked"


async def test_expired_refresh_token(harness: Harness) -> None:
    tokens = await register(harness.client)
    async with harness.ctx.sessionmaker() as s:
        await s.execute(update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await s.commit()
    response = await harness.client.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 401


async def test_logout_revokes_device(harness: Harness) -> None:
    client = harness.client
    tokens = await register(client)
    assert (await client.post("/v1/auth/logout", headers=bearer(tokens))).status_code == 204
    assert (await client.get("/v1/me", headers=bearer(tokens))).status_code == 401
    refresh = await client.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401


async def test_relogin_on_same_device_reuses_it(client: AsyncClient) -> None:
    tokens = await register(client)
    await client.post("/v1/auth/logout", headers=bearer(tokens))
    again = await client.post(
        "/v1/auth/login",
        json={
            "email": "listener@example.com",
            "password": "correct horse battery",
            "device": {**DEVICE, "device_id": tokens["device_id"]},
        },
    )
    # The old device row was deleted on logout, so a fresh one is issued and works.
    assert again.status_code == 200
    assert (await client.get("/v1/me", headers=bearer(again.json()))).status_code == 200

    relogin = await client.post(
        "/v1/auth/login",
        json={
            "email": "listener@example.com",
            "password": "correct horse battery",
            "device": {**DEVICE, "device_id": again.json()["device_id"]},
        },
    )
    assert relogin.json()["device_id"] == again.json()["device_id"]
    # Logging in again on the same device supersedes its previous refresh token.
    stale = await client.post("/v1/auth/refresh", json={"refresh_token": again.json()["refresh_token"]})
    assert stale.status_code == 401


async def test_invalid_and_missing_tokens(client: AsyncClient) -> None:
    assert (await client.get("/v1/me")).status_code == 401
    bad = await client.get("/v1/me", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "invalid_token"
    assert bad.headers["www-authenticate"] == "Bearer"


async def test_email_verification_flow(harness: Harness) -> None:
    await register(harness.client)
    token = _token_from_mail(harness, "verify-email")
    response = await harness.client.post("/v1/auth/verify-email", json={"token": token})
    assert response.status_code == 200
    assert response.json()["email_verified"] is True
    reused = await harness.client.post("/v1/auth/verify-email", json={"token": token})
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "invalid_token"


async def test_password_reset_flow(harness: Harness) -> None:
    client = harness.client
    tokens = await register(client)
    sent_before = len(harness.email.outbox)
    # Unknown e-mail: same answer, nothing sent.
    assert (
        await client.post("/v1/auth/password/forgot", json={"email": "ghost@example.com"})
    ).status_code == 202
    assert len(harness.email.outbox) == sent_before

    assert (
        await client.post("/v1/auth/password/forgot", json={"email": "listener@example.com"})
    ).status_code == 202
    token = _token_from_mail(harness, "reset-password")
    reset = await client.post(
        "/v1/auth/password/reset", json={"token": token, "password": "brand new secret"}
    )
    assert reset.status_code == 204

    # Every existing session is signed out.
    assert (await client.get("/v1/me", headers=bearer(tokens))).status_code == 401
    old = await client.post(
        "/v1/auth/login",
        json={"email": "listener@example.com", "password": "correct horse battery", "device": DEVICE},
    )
    assert old.status_code == 401
    new = await client.post(
        "/v1/auth/login",
        json={"email": "listener@example.com", "password": "brand new secret", "device": DEVICE},
    )
    assert new.status_code == 200
    assert new.json()["user"]["email_verified"] is True
    reused = await client.post(
        "/v1/auth/password/reset", json={"token": token, "password": "another secret 1"}
    )
    assert reused.status_code == 400


async def test_google_sign_in_creates_and_links(harness: Harness) -> None:
    client = harness.client
    await register(client, email="linked@example.com")
    harness.google.identities["google-token-linked"] = GoogleIdentity(
        sub="g-1", email="linked@example.com", email_verified=True, name="Linked"
    )
    harness.google.identities["google-token-new"] = GoogleIdentity(
        sub="g-2", email="fresh@example.com", email_verified=True, name="Fresh Person"
    )
    harness.google.identities["google-token-unverified"] = GoogleIdentity(
        sub="g-3", email="x@example.com", email_verified=False, name=None
    )

    linked = await client.post("/v1/auth/google", json={"id_token": "google-token-linked", "device": DEVICE})
    assert linked.status_code == 200
    assert linked.json()["user"]["email"] == "linked@example.com"
    assert linked.json()["user"]["email_verified"] is True

    fresh = await client.post("/v1/auth/google", json={"id_token": "google-token-new", "device": DEVICE})
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["user"]["display_name"] == "Fresh Person"
    assert fresh.json()["user"]["has_password"] is False

    again = await client.post("/v1/auth/google", json={"id_token": "google-token-new", "device": DEVICE})
    assert again.json()["user"]["id"] == fresh.json()["user"]["id"]

    unverified = await client.post(
        "/v1/auth/google", json={"id_token": "google-token-unverified", "device": DEVICE}
    )
    assert unverified.status_code == 403
    invalid = await client.post(
        "/v1/auth/google", json={"id_token": "google-token-garbage", "device": DEVICE}
    )
    assert invalid.status_code == 401

    async with harness.ctx.sessionmaker() as s:
        assert (await s.scalar(select(User.google_sub).where(User.email == "linked@example.com"))) == "g-1"


async def test_auth_endpoints_are_rate_limited(limited_harness: Harness) -> None:
    client = limited_harness.client
    statuses = []
    for _ in range(4):
        response = await client.post(
            "/v1/auth/login", json={"email": "ghost@example.com", "password": "x", "device": DEVICE}
        )
        statuses.append(response.status_code)
    assert statuses[:2] == [401, 401]
    assert statuses[-1] == 429
    assert int(response.headers["retry-after"]) >= 1
    assert response.json()["error"]["code"] == "rate_limited"
