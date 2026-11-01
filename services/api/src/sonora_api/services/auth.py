"""Authentication: sessions per device, rotating refresh tokens, e-mail tokens."""

import uuid
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, ConflictError, UnauthorizedError
from sonora_api.core.ids import uuid7
from sonora_api.core.logging import get_logger
from sonora_api.core.security import (
    hash_password,
    hash_token,
    issue_access_token,
    new_opaque_token,
    verify_password,
)
from sonora_api.models import Device, RefreshToken, User, UserToken
from sonora_api.models.enums import TokenPurpose
from sonora_api.schemas.auth import DeviceIn, TokenOut
from sonora_api.services.google import GoogleIdentity
from sonora_api.services.users import me_out

log = get_logger("sonora.auth")

_REVOKED_DEVICE_KEY = "revoked:device:{}"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


async def is_device_revoked(redis: Redis, device_id: uuid.UUID) -> bool:
    return bool(await redis.exists(_REVOKED_DEVICE_KEY.format(device_id)))


async def _mark_device_revoked(redis: Redis, settings: Settings, device_id: uuid.UUID) -> None:
    """Access tokens are stateless; a short-lived deny-list entry cuts them off immediately.

    The entry only has to outlive the longest still-valid access token.
    """
    await redis.set(_REVOKED_DEVICE_KEY.format(device_id), "1", ex=settings.access_token_ttl_seconds + 5)


async def _revoke_device_tokens(session: AsyncSession, device_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.device_id == device_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def _resolve_device(session: AsyncSession, redis: Redis, user: User, data: DeviceIn) -> Device:
    """Reuse the client's device record on re-login, otherwise register a new one."""
    if data.device_id is not None:
        device = await session.get(Device, data.device_id)
        if device is not None and device.user_id == user.id:
            await _revoke_device_tokens(session, device.id)
            device.name, device.model, device.app_version = data.name, data.model, data.app_version
            device.platform = data.platform
            device.last_seen_at = _now()
            # A previous sign-out may have deny-listed this device; it's live again.
            await redis.delete(_REVOKED_DEVICE_KEY.format(device.id))
            return device
    device = Device(
        id=uuid7(),
        user_id=user.id,
        platform=data.platform,
        name=data.name,
        model=data.model,
        app_version=data.app_version,
        last_seen_at=_now(),
    )
    session.add(device)
    return device


def _token_out(settings: Settings, user: User, device: Device, refresh: str) -> TokenOut:
    return TokenOut(
        access_token=issue_access_token(settings, user_id=user.id, device_id=device.id, role=user.role),
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_seconds,
        refresh_expires_in=settings.refresh_token_ttl_days * 86400,
        device_id=device.id,
        user=me_out(settings, user),
    )


def _new_refresh(
    settings: Settings, user: User, device: Device, family_id: uuid.UUID
) -> tuple[RefreshToken, str]:
    raw = new_opaque_token()
    row = RefreshToken(
        id=uuid7(),
        user_id=user.id,
        device_id=device.id,
        family_id=family_id,
        token_hash=hash_token(raw),
        expires_at=_now() + timedelta(days=settings.refresh_token_ttl_days),
    )
    return row, raw


async def start_session(
    session: AsyncSession, redis: Redis, settings: Settings, user: User, device_in: DeviceIn
) -> TokenOut:
    device = await _resolve_device(session, redis, user, device_in)
    await session.flush()
    row, raw = _new_refresh(settings, user, device, family_id=uuid7())
    session.add(row)
    await session.commit()
    log.info(
        "session_started", user_id=str(user.id), device_id=str(device.id), platform=device.platform.value
    )
    return _token_out(settings, user, device, raw)


async def refresh_session(
    session: AsyncSession, redis: Redis, settings: Settings, raw_token: str
) -> TokenOut:
    token = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)).with_for_update()
    )
    now = _now()
    if token is None or token.expires_at <= now:
        raise UnauthorizedError("Refresh token is invalid or expired", code="invalid_refresh_token")

    if token.revoked_at is not None:
        rotated_recently = token.replaced_by_id is not None and (now - token.revoked_at) < timedelta(
            seconds=settings.refresh_reuse_grace_seconds
        )
        if rotated_recently:
            # Two tabs/requests refreshed concurrently; the client should pick up the new pair.
            raise UnauthorizedError("Refresh token was just rotated", code="refresh_token_rotated")
        # Reuse of an old token: assume theft and kill the whole family (forces re-login).
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == token.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await session.commit()
        await _mark_device_revoked(redis, settings, token.device_id)
        log.warning("refresh_token_reuse", user_id=str(token.user_id), device_id=str(token.device_id))
        raise UnauthorizedError("Refresh token reuse detected", code="invalid_refresh_token")

    user = await session.get(User, token.user_id)
    device = await session.get(Device, token.device_id)
    if user is None or device is None:
        raise UnauthorizedError("Refresh token is invalid or expired", code="invalid_refresh_token")
    ensure_not_blocked(user)

    successor, raw = _new_refresh(settings, user, device, family_id=token.family_id)
    session.add(successor)
    await session.flush()
    token.revoked_at = now
    token.replaced_by_id = successor.id
    device.last_seen_at = now
    await session.commit()
    return _token_out(settings, user, device, raw)


async def end_session(session: AsyncSession, redis: Redis, settings: Settings, device: Device) -> None:
    """Sign a device out: forget it (its refresh tokens cascade) and deny-list its access token."""
    await session.delete(device)
    await session.commit()
    await _mark_device_revoked(redis, settings, device.id)


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


async def register_user(session: AsyncSession, *, email: str, password: str, display_name: str) -> User:
    email = normalize_email(email)
    if await session.scalar(select(User.id).where(User.email == email)):
        raise ConflictError("An account with this e-mail already exists", code="email_taken")
    user = User(
        id=uuid7(), email=email, password_hash=await hash_password(password), display_name=display_name
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:  # concurrent registration with the same e-mail
        await session.rollback()
        raise ConflictError("An account with this e-mail already exists", code="email_taken") from exc
    return user


def ensure_not_blocked(user: User) -> None:
    if user.blocked_at is not None:
        raise AppError(
            "Account is blocked" + (f": {user.block_reason}" if user.block_reason else ""),
            code="account_blocked",
            status_code=403,
        )


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User:
    user = await session.scalar(select(User).where(User.email == normalize_email(email)))
    check = await verify_password(user.password_hash if user else None, password)
    if user is None or not check.ok:
        raise UnauthorizedError("Wrong e-mail or password", code="invalid_credentials")
    ensure_not_blocked(user)
    if check.rehash:
        user.password_hash = check.rehash
    return user


async def google_account(session: AsyncSession, identity: GoogleIdentity) -> User:
    """Find the account for a Google identity: by `sub`, then by verified e-mail, else create."""
    user = await session.scalar(select(User).where(User.google_sub == identity.sub))
    if user is not None:
        ensure_not_blocked(user)
        return user
    if not identity.email_verified:
        raise AppError(
            "Google account e-mail is not verified", code="google_email_unverified", status_code=403
        )
    user = await session.scalar(select(User).where(User.email == identity.email))
    if user is not None:
        ensure_not_blocked(user)
        user.google_sub = identity.sub
        user.email_verified_at = user.email_verified_at or _now()
        return user
    user = User(
        id=uuid7(),
        email=identity.email,
        google_sub=identity.sub,
        email_verified_at=_now(),
        display_name=(identity.name or identity.email.split("@")[0])[:64],
    )
    session.add(user)
    await session.flush()
    return user


# ---------------------------------------------------------------------------
# E-mail tokens (verification, password reset)
# ---------------------------------------------------------------------------


async def issue_user_token(session: AsyncSession, user: User, purpose: TokenPurpose, ttl: timedelta) -> str:
    # Only the newest token of a purpose stays valid.
    await session.execute(
        update(UserToken)
        .where(UserToken.user_id == user.id, UserToken.purpose == purpose, UserToken.used_at.is_(None))
        .values(used_at=_now())
    )
    raw = new_opaque_token()
    session.add(
        UserToken(
            id=uuid7(), user_id=user.id, purpose=purpose, token_hash=hash_token(raw), expires_at=_now() + ttl
        )
    )
    await session.flush()
    return raw


async def consume_user_token(session: AsyncSession, raw: str, purpose: TokenPurpose) -> User:
    token = await session.scalar(
        select(UserToken)
        .where(UserToken.token_hash == hash_token(raw), UserToken.purpose == purpose)
        .with_for_update()
    )
    if token is None or token.used_at is not None or token.expires_at <= _now():
        raise AppError("Link is invalid or has expired", code="invalid_token")
    token.used_at = _now()
    user = await session.get(User, token.user_id)
    if user is None:
        raise AppError("Link is invalid or has expired", code="invalid_token")
    return user


async def find_user_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == normalize_email(email)))


async def verify_email(session: AsyncSession, raw_token: str) -> User:
    user = await consume_user_token(session, raw_token, TokenPurpose.VERIFY_EMAIL)
    user.email_verified_at = user.email_verified_at or _now()
    await session.commit()
    return user


async def reset_password(
    session: AsyncSession, redis: Redis, settings: Settings, raw_token: str, new_password: str
) -> None:
    """Set a new password and sign out every device of the account."""
    user = await consume_user_token(session, raw_token, TokenPurpose.PASSWORD_RESET)
    user.password_hash = await hash_password(new_password)
    # Following the reset link proves control of the mailbox.
    user.email_verified_at = user.email_verified_at or _now()
    signed_out = await sign_out_everywhere(session, redis, settings, user.id)
    log.info("password_reset", user_id=str(user.id), devices_signed_out=signed_out)


async def sign_out_everywhere(
    session: AsyncSession, redis: Redis, settings: Settings, user_id: uuid.UUID
) -> int:
    """Revoke every session of a user (password reset, block, admin action). Commits."""
    device_ids = list(await session.scalars(select(Device.id).where(Device.user_id == user_id)))
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await session.commit()
    for device_id in device_ids:
        await _mark_device_revoked(redis, settings, device_id)
    return len(device_ids)
