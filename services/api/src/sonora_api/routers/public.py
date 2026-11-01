"""Home page, playlists, genres, lyrics, platform status, listening events."""

import uuid
from typing import Annotated

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
from sonora_api.services import editorial, events, platform

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
    return cached_json(request, playlist, max_age=60, public=viewer is None)


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


@router.get("/tracks/{track_id}/lyrics")
async def get_lyrics(track_id: uuid.UUID, viewer: CurrentViewer, session: Session) -> LyricsOut:
    visible = await session.scalar(
        select(Track.id).where(Track.id == track_id, Track.status == TrackStatus.READY, Track.has_lyrics)
    )
    lyrics = await session.get(Lyrics, track_id) if visible else None
    if lyrics is None:
        raise NotFoundError("No lyrics for this track")
    if lyrics.type == LyricsType.LINE:
        return LyricsOut(
            type=lyrics.type,
            language=lyrics.language,
            lines=[LyricsLine(**line) for line in lyrics.body["lines"]],
        )
    return LyricsOut(type=lyrics.type, language=lyrics.language, text=str(lyrics.body.get("text", "")))


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
) -> SearchOut:
    """Search published music by title or artist (substring, case-insensitive).

    Typo tolerance and transliteration arrive with Meilisearch (ROADMAP, phase 5).
    """
    return await editorial.search(session, ctx.settings, q.strip(), limit, viewer.user if viewer else None)
