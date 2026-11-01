"""Playback authorisation: which rendition a listener gets and the HLS URL for it."""

import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core import stream_tokens
from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, ForbiddenError, NotFoundError
from sonora_api.models import Release, Track, TrackFile
from sonora_api.models.enums import Quality, TrackStatus
from sonora_api.models.users import User
from sonora_api.schemas.stream import RequestedQuality, StreamOut
from sonora_api.services import platform
from sonora_api.services.catalog import is_playable, release_visible

#: Best first. A request for an unavailable tier falls back to the next one down.
QUALITY_ORDER = (Quality.HIRES, Quality.LOSSLESS, Quality.HIGH, Quality.NORMAL, Quality.LOW)
#: Presigned storage URLs handed out per segment request.
SEGMENT_URL_TTL_SECONDS = 300
#: Playlist URLs outlive the track comfortably (pauses, scrubbing), capped at 12 h.
_MIN_TOKEN_TTL = timedelta(hours=1)
_MAX_TOKEN_TTL = timedelta(hours=12)

#: Everything a playlist may reference. Anything else (`..`, other tracks' keys) is rejected.
STREAM_PATH_RE = re.compile(
    r"^(?:master\.m3u8|(?:hires|lossless|high|normal|low)/(?:playlist\.m3u8|init\.mp4|seg_\d{5}\.m4s))$"
)


def allowed_qualities(config: platform.PlatformConfig) -> set[Quality]:
    """Tiers the admin has switched on, capped at `max_quality`."""
    cap = QUALITY_ORDER.index(Quality(config.max_quality))
    allowed = set(QUALITY_ORDER[cap:])
    if not config.hires_enabled:
        allowed.discard(Quality.HIRES)
    if not config.lossless_enabled:
        allowed.discard(Quality.LOSSLESS)
    return allowed


def pick_quality(requested: Quality, available: list[Quality]) -> Quality:
    start = QUALITY_ORDER.index(requested)
    for quality in QUALITY_ORDER[start:]:
        if quality in available:
            return quality
    return available[-1]


async def stream_for(
    session: AsyncSession, settings: Settings, track_id: uuid.UUID, viewer: User, requested: RequestedQuality
) -> StreamOut:
    now = datetime.now(UTC)
    track = await session.scalar(
        select(Track)
        .join(Track.release)
        .where(Track.id == track_id, Track.status == TrackStatus.READY, release_visible(now))
    )
    if track is None or not track.hls_master_key:
        raise NotFoundError("Track not found")
    if not is_playable(track, viewer):
        raise ForbiddenError("Explicit content is filtered in your settings", code="explicit_filtered")

    files = {
        f.quality: f for f in await session.scalars(select(TrackFile).where(TrackFile.track_id == track.id))
    }
    allowed = allowed_qualities(await platform.get_config(session))
    available = [q for q in QUALITY_ORDER if q in files and q in allowed]
    if not available:
        raise AppError("Track has no playable renditions", code="not_playable", status_code=409)

    prefix = track.hls_master_key.rsplit("/", 1)[0]
    ttl = min(max(timedelta(milliseconds=track.duration_ms * 3), _MIN_TOKEN_TTL), _MAX_TOKEN_TTL)
    token = stream_tokens.issue(
        settings, stream_tokens.StreamGrant(track_id=track.id, user_id=viewer.id, prefix=prefix), ttl=ttl
    )
    if requested == "auto":
        path, quality, codec = "master.m3u8", "auto", None
    else:
        chosen = pick_quality(Quality(requested), available)
        path, quality, codec = f"{chosen.value}/playlist.m3u8", chosen, files[chosen].codec
    return StreamOut(
        url=f"/v1/stream/{token}/{path}",
        quality=quality,
        qualities=available,
        codec=codec,
        duration_ms=track.duration_ms,
        track_gain=track.track_gain,
        album_gain=track.album_gain,
        expires_in=int(ttl.total_seconds()),
    )


async def preview_key(session: AsyncSession, track_id: uuid.UUID) -> str:
    if not (await platform.get_config(session)).guest_previews:
        raise NotFoundError("Previews are disabled")
    now = datetime.now(UTC)
    key = await session.scalar(
        select(Track.preview_key)
        .join(Release, Release.id == Track.release_id)
        .where(Track.id == track_id, Track.status == TrackStatus.READY, release_visible(now))
    )
    if not key:
        raise NotFoundError("Preview not found")
    return key
