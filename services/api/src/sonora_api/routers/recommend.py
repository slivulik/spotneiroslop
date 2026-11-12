"""/v1/me/wave (+ Wave 2.0 sessions), /v1/me/mixes, /v1/me/top-artists, /v1/artists/{id}/similar|stats."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from sonora_api.deps import Ctx, CurrentViewer, Session
from sonora_api.routers import API_V1
from sonora_api.schemas.catalog import TrackOut
from sonora_api.schemas.common import ERROR_RESPONSES
from sonora_api.schemas.editorial import ArtistSummary
from sonora_api.schemas.recommend import (
    ArtistStatsOut,
    MixOut,
    MixSummary,
    WaveFeedbackIn,
    WaveSessionOut,
    WaveSettings,
    WaveStartIn,
)
from sonora_api.services import recommend, wave

router = APIRouter(prefix=API_V1, tags=["recommendations"], responses=ERROR_RESPONSES)


@router.get("/me/wave")
async def get_wave(
    viewer: CurrentViewer,
    session: Session,
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    exclude: Annotated[list[uuid.UUID], Query(max_length=300)] = [],  # noqa: B006 - FastAPI query default
    seed_track: uuid.UUID | None = None,
    seed_artist: uuid.UUID | None = None,
) -> list[TrackOut]:
    """Next batch of the endless personal radio; pass the session's track ids in `exclude`.

    With `seed_track` / `seed_artist` it becomes a radio station started from that track or artist.
    """
    return await recommend.wave(
        session, ctx.settings, viewer.user, limit, set(exclude), seed_track, seed_artist
    )


@router.post("/me/wave/sessions", status_code=status.HTTP_201_CREATED)
async def start_wave_session(
    body: WaveStartIn, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> WaveSessionOut:
    """Wave 2.0: start «Моя волна» (or a radio from `seed_track` / `seed_artist`) with settings.

    The server remembers what the session served and how the listener reacted, so `next` never
    repeats a track and adapts to skips, likes and dislikes.
    """
    return await wave.start(session, ctx.redis, ctx.settings, viewer.user, body)


@router.get("/me/wave/sessions/{session_id}/next")
async def next_wave_tracks(
    session_id: uuid.UUID,
    viewer: CurrentViewer,
    session: Session,
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[TrackOut]:
    """The next batch of the session: never a track it already served, never empty while anything
    playable is left (settings relax: language, then mood, then character)."""
    return await wave.next_batch(session, ctx.redis, ctx.settings, viewer.user, session_id, limit)


@router.post("/me/wave/sessions/{session_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
async def send_wave_feedback(
    session_id: uuid.UUID, body: WaveFeedbackIn, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> Response:
    """What the listener did with a track; plays are still reported through `/v1/events/batch`."""
    await wave.feedback(session, ctx.redis, viewer.user, session_id, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/wave/settings")
async def get_wave_settings(viewer: CurrentViewer, session: Session) -> WaveSettings:
    """Settings of the listener's latest wave session (all null before the first one)."""
    return await wave.latest_settings(session, viewer.user)


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
