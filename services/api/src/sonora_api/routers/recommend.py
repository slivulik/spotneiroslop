"""/v1/me/wave, /v1/me/mixes, /v1/me/top-artists, /v1/artists/{id}/similar|stats."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from sonora_api.deps import Ctx, CurrentViewer, Session
from sonora_api.routers import API_V1
from sonora_api.schemas.catalog import TrackOut
from sonora_api.schemas.common import ERROR_RESPONSES
from sonora_api.schemas.editorial import ArtistSummary
from sonora_api.schemas.recommend import ArtistStatsOut, MixOut, MixSummary
from sonora_api.services import recommend

router = APIRouter(prefix=API_V1, tags=["recommendations"], responses=ERROR_RESPONSES)


@router.get("/me/wave")
async def get_wave(
    viewer: CurrentViewer,
    session: Session,
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    exclude: Annotated[list[uuid.UUID], Query(max_length=300)] = [],  # noqa: B006 - FastAPI query default
) -> list[TrackOut]:
    """Next batch of the endless personal radio; pass the session's track ids in `exclude`."""
    return await recommend.wave(session, ctx.settings, viewer.user, limit, set(exclude))


@router.get("/me/mixes")
async def get_mixes(viewer: CurrentViewer, session: Session, ctx: Ctx) -> list[MixSummary]:
    return await recommend.mixes(session, ctx.settings, viewer.user)


@router.get("/me/mixes/{key}")
async def get_mix(key: str, viewer: CurrentViewer, session: Session, ctx: Ctx) -> MixOut:
    return await recommend.mix(session, ctx.settings, viewer.user, key)


@router.get("/me/top-artists")
async def get_top_artists(
    viewer: CurrentViewer, session: Session, ctx: Ctx, limit: Annotated[int, Query(ge=1, le=30)] = 12
) -> list[ArtistSummary]:
    return await recommend.top_artists(session, ctx.settings, viewer.user, limit)


@router.get("/artists/{artist_id}/similar")
async def get_similar_artists(
    artist_id: uuid.UUID, session: Session, ctx: Ctx, limit: Annotated[int, Query(ge=1, le=30)] = 12
) -> list[ArtistSummary]:
    return await recommend.similar_artists(session, ctx.settings, artist_id, limit)


@router.get("/artists/{artist_id}/stats")
async def get_artist_stats(artist_id: uuid.UUID, session: Session) -> ArtistStatsOut:
    return await recommend.artist_stats(session, artist_id)
