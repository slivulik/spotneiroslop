import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import anyio.to_thread
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from sonora_api.core.config import Settings
from sonora_api.core.errors import UnauthorizedError
from sonora_api.models.enums import UserRole

# RFC 9106 "second recommended" profile: Argon2id, 64 MiB, t=3, p=4.
_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)
# Verified when the user doesn't exist, so login latency doesn't reveal registered emails.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


async def hash_password(password: str) -> str:
    return await anyio.to_thread.run_sync(_hasher.hash, password)


@dataclass(frozen=True, slots=True)
class PasswordCheck:
    ok: bool
    #: New hash when the stored one uses outdated parameters.
    rehash: str | None = None


async def verify_password(stored_hash: str | None, password: str) -> PasswordCheck:
    def _verify() -> PasswordCheck:
        try:
            _hasher.verify(stored_hash or _DUMMY_HASH, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return PasswordCheck(ok=False)
        if stored_hash is None:
            return PasswordCheck(ok=False)
        if _hasher.check_needs_rehash(stored_hash):
            return PasswordCheck(ok=True, rehash=_hasher.hash(password))
        return PasswordCheck(ok=True)

    return await anyio.to_thread.run_sync(_verify)


def new_opaque_token() -> str:
    """256-bit URL-safe random token (refresh, e-mail verification, password reset)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Tokens are high-entropy, so a fast hash is sufficient (no need for a KDF)."""
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class AccessClaims:
    user_id: uuid.UUID
    device_id: uuid.UUID
    role: UserRole
    expires_at: datetime


def issue_access_token(
    settings: Settings, *, user_id: uuid.UUID, device_id: uuid.UUID, role: UserRole
) -> str:
    now = datetime.now(UTC)
    payload = {
        "iss": settings.jwt_issuer,
        "sub": str(user_id),
        "did": str(device_id),
        "role": role.value,
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256")


def decode_access_token(settings: Settings, token: str) -> AccessClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "did", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError("Access token expired", code="token_expired") from exc
    except jwt.InvalidTokenError as exc:
        raise UnauthorizedError("Invalid access token", code="invalid_token") from exc
    if payload.get("typ") != "access":
        raise UnauthorizedError("Invalid access token", code="invalid_token")
    try:
        return AccessClaims(
            user_id=uuid.UUID(payload["sub"]),
            device_id=uuid.UUID(payload["did"]),
            role=UserRole(payload.get("role", UserRole.USER.value)),
            expires_at=datetime.fromtimestamp(payload["exp"], UTC),
        )
    except (ValueError, KeyError) as exc:
        raise UnauthorizedError("Invalid access token", code="invalid_token") from exc
