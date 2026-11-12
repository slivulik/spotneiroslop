"""Home page, playlists, genres, lyrics, platform status, listening events."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field
from sqlalchemy import select

from sonora_api.core.caching import cached_json
from sonora_api.core.errors import NotFoundError
from sonora_api.deps import Ctx, CurrentViewer, OptionalViewer, Session
from sonora_api.models import Lyrics, Track
from sonora_api.models.enums import HomeSectionType, LyricsType, TrackStatus
from sonora_api.routers import API_V1
from sonora_api.schemas.catalog import TrackList
from sonora_api.schemas.common import ERROR_RESPONSES, ApiModel
from sonora_api.schemas.editorial import (
    GenreDetail,
    HomeOut,
    PlatformPublic,
    PlaylistOut,
    SearchOut,
    SectionConfig,
)
from sonora_api.schemas.events import EventsIn, EventsOut
from sonora_api.services import editorial, events, lyrics_on_demand, platform

router = APIRouter(prefix=API_V1, tags=["catalog"], responses=ERROR_RESPONSES)


@router.get("/home", response_model=HomeOut)
async def get_home(request: Request, session: Session, ctx: Ctx, viewer: OptionalViewer) -> Response:
    """The home page: admin-composed blocks, or a rich built-in default."""
    page = await editorial.home(session, ctx.settings, viewer.user if viewer else None)
    return cached_json(request, page, max_age=60 if viewer is None else 15, public=viewer is None)


@router.get("/playlists/{playlist_id}", response_model=PlaylistOut)
async def get_playlist(
    playlist_id: uuid.UUID, request: Request, session: Session, ctx: Ctx, viewer: OptionalViewer
) -> Response:
    playlist = await editorial.get_public_playlist(
        session, ctx.settings, playlist_id, viewer.user if viewer else None
    )
    # User playlists change under their owner's hands: always revalidate (ETag makes it a cheap 304).
    max_age = 0 if playlist.owner_id is not None else 60
    return cached_json(request, playlist, max_age=max_age, public=viewer is None)


@router.get("/genres/{slug}", response_model=GenreDetail)
async def get_genre(
    slug: str, request: Request, session: Session, ctx: Ctx, viewer: OptionalViewer
) -> Response:
    detail = await editorial.genre_detail(session, ctx.settings, slug, viewer.user if viewer else None)
    return cached_json(request, detail, max_age=120, public=viewer is None)


class LyricsLine(ApiModel):
    start_ms: int
    end_ms: int
    text: str


class LyricsOut(ApiModel):
    type: LyricsType
    language: str | None
    lines: list[LyricsLine] = Field(default_factory=list)
    text: str | None = None


@router.get(
    "/tracks/{track_id}/lyrics",
    response_model=LyricsOut,
    responses={204: {"description": "The track exists but has no lyrics"}},
)
async def get_lyrics(track_id: uuid.UUID, viewer: CurrentViewer, session: Session, ctx: Ctx) -> Response:
    """Synced (line) or plain lyrics; 204 when the track simply has none (not an error).

    A track without lyrics gets one LRCLIB lookup on the first request (unless enrichment is
    switched off in the admin panel), so it is worth asking even when `has_lyrics` is false.
    """
    track = await session.scalar(select(Track).where(Track.id == track_id, Track.status == TrackStatus.READY))
    if track is None:
        raise NotFoundError("Track not found")
    lyrics = await session.get(Lyrics, track_id) if track.has_lyrics else None
    if lyrics is None and not track.has_lyrics:
        lyrics = await lyrics_on_demand.find_missing(session, ctx.redis, track)
    if lyrics is None:
        return Response(status_code=204)
    if lyrics.type == LyricsType.LINE:
        out = LyricsOut(
            type=lyrics.type,
            language=lyrics.language,
            lines=[LyricsLine(**line) for line in lyrics.body["lines"]],
        )
    else:
        out = LyricsOut(type=lyrics.type, language=lyrics.language, text=str(lyrics.body.get("text", "")))
    return Response(out.model_dump_json(), media_type="application/json")


@router.get("/platform")
async def get_platform(session: Session) -> PlatformPublic:
    """Public switches: announcement banner, maintenance notice, registration."""
    config = await platform.get_config(session)
    return PlatformPublic(
        registration_open=config.registration_open,
        guest_previews=config.guest_previews,
        announcement=config.announcement.model_dump() if config.announcement.enabled else None,
        maintenance=config.maintenance.model_dump() if config.maintenance.enabled else None,
    )


@router.post("/events/batch")
async def post_events(body: EventsIn, viewer: CurrentViewer, session: Session, ctx: Ctx) -> EventsOut:
    """Playback events (idempotent by `event_id`). A play counts after 30 s or half the track."""
    return await events.ingest(session, ctx.redis, viewer.user, viewer.claims.device_id, body)


@router.get("/me/recent")
async def recent_tracks(viewer: CurrentViewer, session: Session, ctx: Ctx) -> TrackList:
    block = await editorial.resolve_block(
        session, ctx.settings, block_id="recent", type_=HomeSectionType.TRACKS,
        title="", subtitle=None, config=SectionConfig(source="recent", limit=30), viewer=viewer.user,
    )  # fmt: skip
    return TrackList(items=block.tracks if block else [])


@router.get("/search")
async def search(
    session: Session,
    ctx: Ctx,
    viewer: OptionalViewer,
    q: Annotated[str, Query(min_length=1, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=30)] = 10,
    sort: Literal["relevance", "new", "popular"] = "relevance",
) -> SearchOut:
    """Search published music: tracks, releases (albums and singles), artists, genres, playlists.
    Case-insensitive substring match plus typo tolerance (trigram similarity)."""
    return await editorial.search(
        session, ctx.settings, q.strip(), limit, viewer.user if viewer else None, sort
    )
