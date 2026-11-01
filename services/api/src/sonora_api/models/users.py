import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from sonora_api.models.base import Base, created_at, pk_uuid, str_enum, updated_at
from sonora_api.models.enums import Platform, TokenPurpose, UserRole


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = pk_uuid()
    #: Stored lower-cased; uniqueness is enforced on the normalised value.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    #: NULL for accounts created through Google sign-in only.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    email_verified_at: Mapped[datetime | None]
    display_name: Mapped[str] = mapped_column(String(64))
    avatar_key: Mapped[str | None] = mapped_column(String(512))
    country: Mapped[str | None] = mapped_column(String(2))
    language: Mapped[str] = mapped_column(String(8), server_default="ru")
    role: Mapped[UserRole] = mapped_column(
        str_enum(UserRole, "user_role"), server_default=UserRole.USER.value
    )
    explicit_filter: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    #: Client preferences validated by `schemas.me.UserSettings`; defaults applied on read.
    settings: Mapped[dict[str, Any]] = mapped_column(server_default=text("'{}'::jsonb"))
    #: Blocked accounts can't sign in, refresh or use existing access tokens.
    blocked_at: Mapped[datetime | None]
    block_reason: Mapped[str | None] = mapped_column(String(256))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class UserToken(Base):
    """Single-use e-mail tokens (verification, password reset). Only the hash is stored."""

    __tablename__ = "user_tokens"

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[TokenPurpose] = mapped_column(str_enum(TokenPurpose, "token_purpose"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[Platform] = mapped_column(str_enum(Platform, "platform"))
    name: Mapped[str] = mapped_column(String(128))
    model: Mapped[str | None] = mapped_column(String(128))
    app_version: Mapped[str | None] = mapped_column(String(32))
    push_token: Mapped[str | None] = mapped_column(Text)
    offline_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = created_at()
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())


class RefreshToken(Base):
    """Opaque rotating refresh tokens.

    Each login starts a `family`; every refresh revokes the presented token and issues a
    successor in the same family. Presenting an already-rotated token outside the grace
    window means it leaked, so the whole family is revoked.
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_family_active", "family_id", postgresql_where=text("revoked_at IS NULL")),
    )

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[uuid.UUID]
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("refresh_tokens.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = created_at()
