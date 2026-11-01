import uuid
from typing import Any

from fastapi import APIRouter, Body, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from sonora_api.core.errors import AppError, NotFoundError
from sonora_api.deps import Ctx, CurrentViewer, Session
from sonora_api.models import Artist, Device, FollowArtist, Genre
from sonora_api.routers import API_V1
from sonora_api.schemas.common import ERROR_RESPONSES
from sonora_api.schemas.me import DeviceOut, MeOut, MePatch, OnboardingIn, UserSettings
from sonora_api.services import auth as auth_service
from sonora_api.services.users import apply_settings_patch, me_out, read_settings

router = APIRouter(prefix=f"{API_V1}/me", tags=["me"], responses=ERROR_RESPONSES)

NON_NULLABLE = frozenset({"display_name", "language", "explicit_filter"})


@router.get("")
async def get_me(viewer: CurrentViewer, ctx: Ctx) -> MeOut:
    return me_out(ctx.settings, viewer.user)


@router.patch("")
async def patch_me(body: MePatch, viewer: CurrentViewer, session: Session, ctx: Ctx) -> MeOut:
    user = viewer.user
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None and field in NON_NULLABLE:
            raise AppError(f"{field} cannot be null", code="validation_error", status_code=422)
        setattr(user, field, value.strip() if field == "display_name" else value)
    await session.commit()
    return me_out(ctx.settings, user)


@router.get("/devices")
async def list_devices(viewer: CurrentViewer, session: Session) -> list[DeviceOut]:
    devices = await session.scalars(
        select(Device).where(Device.user_id == viewer.user.id).order_by(Device.last_seen_at.desc())
    )
    return [
        DeviceOut(
            id=d.id,
            platform=d.platform,
            name=d.name,
            model=d.model,
            app_version=d.app_version,
            offline_enabled=d.offline_enabled,
            created_at=d.created_at,
            last_seen_at=d.last_seen_at,
            current=d.id == viewer.claims.device_id,
        )
        for d in devices
    ]


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(device_id: uuid.UUID, viewer: CurrentViewer, session: Session, ctx: Ctx) -> None:
    """Sign a device out remotely (also removes its offline-download slot)."""
    device = await session.get(Device, device_id)
    if device is None or device.user_id != viewer.user.id:
        raise NotFoundError("Device not found")
    await auth_service.end_session(session, ctx.redis, ctx.settings, device)


@router.get("/settings")
async def get_settings(viewer: CurrentViewer) -> UserSettings:
    return read_settings(viewer.user)


@router.patch("/settings")
async def patch_settings(
    viewer: CurrentViewer,
    session: Session,
    patch: dict[str, Any] = Body(
        description="JSON Merge Patch (RFC 7396) of UserSettings; `null` resets a value to its default",
        examples=[{"audio": {"crossfade_seconds": 6}, "equalizer": {"enabled": True}}],
    ),
) -> UserSettings:
    updated = apply_settings_patch(viewer.user, patch)
    await session.commit()
    return updated


@router.post("/onboarding")
async def complete_onboarding(body: OnboardingIn, viewer: CurrentViewer, session: Session, ctx: Ctx) -> MeOut:
    """Store initial taste (followed artists, favourite genres) used to cold-start recommendations."""
    user = viewer.user
    artist_ids = list(dict.fromkeys(body.artist_ids))
    genre_ids = list(dict.fromkeys(body.genre_ids))
    if artist_ids:
        known = set(await session.scalars(select(Artist.id).where(Artist.id.in_(artist_ids))))
        if missing := [str(a) for a in artist_ids if a not in known]:
            raise AppError(
                "Unknown artists", code="validation_error", status_code=422, details={"artist_ids": missing}
            )
        await session.execute(
            insert(FollowArtist)
            .values([{"user_id": user.id, "artist_id": a} for a in artist_ids])
            .on_conflict_do_nothing()
        )
    if genre_ids:
        known = set(await session.scalars(select(Genre.id).where(Genre.id.in_(genre_ids))))
        if missing := [str(g) for g in genre_ids if g not in known]:
            raise AppError(
                "Unknown genres", code="validation_error", status_code=422, details={"genre_ids": missing}
            )
    apply_settings_patch(user, {"taste": {"genre_ids": [str(g) for g in genre_ids]}})
    user.onboarding_completed = True
    await session.commit()
    return me_out(ctx.settings, user)
