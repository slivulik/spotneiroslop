import time
import uuid

import pytest
from redis.asyncio import Redis

from sonora_api.core.errors import AppError
from sonora_api.core.ids import uuid7
from sonora_api.core.pagination import decode_cursor, encode_cursor
from sonora_api.core.ratelimit import RateLimiter
from sonora_api.core.security import decode_access_token, hash_password, issue_access_token, verify_password
from sonora_api.models import User
from sonora_api.models.enums import UserRole
from sonora_api.services.users import merge_patch, read_settings
from tests.conftest import REDIS_URL, make_settings


def test_uuid7_layout_and_ordering() -> None:
    ids = [uuid7() for _ in range(200)]
    assert all(u.version == 7 and u.variant == uuid.RFC_4122 for u in ids)
    timestamps = [u.int >> 80 for u in ids]
    assert timestamps == sorted(timestamps)
    assert abs(timestamps[-1] - time.time() * 1000) < 5_000
    assert len(set(ids)) == len(ids)


def test_cursor_roundtrip_and_tampering() -> None:
    cursor = encode_cursor({"d": "2025-01-01", "id": "x"})
    assert decode_cursor(cursor, keys=frozenset({"d", "id"})) == {"d": "2025-01-01", "id": "x"}
    assert decode_cursor(None, keys=frozenset({"d"})) is None
    with pytest.raises(AppError):
        decode_cursor(cursor, keys=frozenset({"other"}))
    with pytest.raises(AppError):
        decode_cursor("bm90IGpzb24", keys=frozenset({"d"}))


def test_merge_patch_rfc7396() -> None:
    target = {"a": {"b": 1, "c": 2}, "d": [1, 2]}
    assert merge_patch(target, {"a": {"b": None, "e": 3}, "d": [3]}) == {"a": {"c": 2, "e": 3}, "d": [3]}
    assert target == {"a": {"b": 1, "c": 2}, "d": [1, 2]}  # input untouched


def test_read_settings_drops_stale_keys() -> None:
    user = User(settings={"audio": {"crossfade_seconds": 5, "removed_option": True}, "legacy": {}})
    settings = read_settings(user)
    assert settings.audio.crossfade_seconds == 5


async def test_password_hash_roundtrip() -> None:
    stored = await hash_password("s3cret-passphrase")
    assert stored.startswith("$argon2id$")
    assert (await verify_password(stored, "s3cret-passphrase")).ok
    assert not (await verify_password(stored, "wrong")).ok
    assert not (await verify_password(None, "anything")).ok
    assert not (await verify_password("not-a-hash", "anything")).ok


def test_access_token_roundtrip_and_rejection() -> None:
    settings = make_settings()
    user_id, device_id = uuid7(), uuid7()
    token = issue_access_token(settings, user_id=user_id, device_id=device_id, role=UserRole.ADMIN)
    claims = decode_access_token(settings, token)
    assert (claims.user_id, claims.device_id, claims.role) == (user_id, device_id, UserRole.ADMIN)

    other = make_settings(jwt_secret="another-secret-another-secret-another-0")
    with pytest.raises(AppError) as exc:
        decode_access_token(other, token)
    assert exc.value.code == "invalid_token"

    expired = make_settings(access_token_ttl_seconds=-10)
    with pytest.raises(AppError) as exc:
        decode_access_token(
            settings, issue_access_token(expired, user_id=user_id, device_id=device_id, role=UserRole.USER)
        )
    assert exc.value.code == "token_expired"


async def test_gcra_rate_limiter() -> None:
    redis = Redis.from_url(REDIS_URL)
    try:
        limiter = RateLimiter(redis)
        results = [await limiter.hit("unit", per_minute=60, burst=3) for _ in range(5)]
        assert [r.allowed for r in results] == [True, True, True, False, False]
        assert results[-1].retry_after >= 1
        # Separate keys have separate budgets.
        assert (await limiter.hit("unit-2", per_minute=60, burst=1)).allowed
    finally:
        await redis.aclose()
