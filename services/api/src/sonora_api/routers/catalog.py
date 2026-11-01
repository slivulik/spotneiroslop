import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from sonora_api.core.caching import cached_json
from sonora_api.core.errors import AppError
from sonora_api.core.pagination import MAX_PAGE_SIZE
from sonora_api.deps import Ctx, OptionalViewer, Session
from sonora_api.models.enums import ReleaseType
from sonora_api.routers import API_V1
from sonora_api.schemas.catalog import (
    ArtistOut,
    GenreList,
    MoodList,
    ReleaseOut,
    ReleaseSummary,
    TrackList,
    TrackOut,
)
from sonora_api.schemas.common import ERROR_RESPONSES, Page
from sonora_api.services import catalog

router = APIRouter(prefix=API_V1, tags=["catalog"], responses=ERROR_RESPONSES)

MAX_BATCH = 100
# Personalised (explicit filter) → private; anonymous responses can sit on the CDN.
PRIVATE_TTL = 60
PUBLIC_TTL = 300


def _cache(
    request: Request,
    model: TrackOut | TrackList | ReleaseOut | ArtistOut | Page[ReleaseSummary],
    viewer: OptionalViewer,
) -> Response:
    public = viewer is None
    return cached_json(
        request,
        model,
        max_age=PUBLIC_TTL if public else PRIVATE_TTL,
        public=public,
        stale_while_revalidate=PUBLIC_TTL if public else 0,
    )


@router.get("/tracks", response_model=TrackList)
async def get_tracks(
    request: Request,
    session: Session,
    ctx: Ctx,
    viewer: OptionalViewer,
    ids: Annotated[str, Query(description=f"Comma-separated track ids, up to {MAX_BATCH}")],
) -> Response:
    try:
        parsed = [uuid.UUID(part.strip()) for part in ids.split(",") if part.strip()]
    except ValueError as exc:
        raise AppError("ids must be comma-separated UUIDs", code="validation_error", status_code=422) from exc
    if len(parsed) > MAX_BATCH:
        raise AppError(f"At most {MAX_BATCH} ids per request", code="validation_error", status_code=422)
    items = await catalog.get_tracks(session, ctx.settings, parsed, viewer.user if viewer else None)
    return _cache(request, TrackList(items=items), viewer)


@router.get("/tracks/{track_id}", response_model=TrackOut)
async def get_track(
    track_id: uuid.UUID, request: Request, session: Session, ctx: Ctx, viewer: OptionalViewer
) -> Response:
    track = await catalog.get_track(session, ctx.settings, track_id, viewer.user if viewer else None)
    return _cache(request, track, viewer)


@router.get("/releases/{release_id}", response_model=ReleaseOut)
async def get_release(
    release_id: uuid.UUID, request: Request, session: Session, ctx: Ctx, viewer: OptionalViewer
) -> Response:
    release = await catalog.get_release(session, ctx.settings, release_id, viewer.user if viewer else None)
    return _cache(request, release, viewer)


@router.get("/artists/{artist_id}", response_model=ArtistOut)
async def get_artist(artist_id: uuid.UUID, request: Request, session: Session, ctx: Ctx) -> Response:
    artist = await catalog.get_artist(session, ctx.settings, artist_id)
    return cached_json(request, artist, max_age=PUBLIC_TTL, public=True, stale_while_revalidate=PUBLIC_TTL)


@router.get("/artists/{artist_id}/top-tracks", response_model=TrackList)
async def get_artist_top_tracks(
    artist_id: uuid.UUID, request: Request, session: Session, ctx: Ctx, viewer: OptionalViewer
) -> Response:
    tracks = await catalog.get_artist_top_tracks(
        session, ctx.settings, artist_id, viewer.user if viewer else None
    )
    return _cache(request, TrackList(items=tracks), viewer)


@router.get("/artists/{artist_id}/releases", response_model=Page[ReleaseSummary])
async def get_artist_releases(
    artist_id: uuid.UUID,
    request: Request,
    session: Session,
    ctx: Ctx,
    viewer: OptionalViewer,
    types: Annotated[list[ReleaseType] | None, Query(alias="type")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 20,
    cursor: str | None = None,
) -> Response:
    page = await catalog.get_artist_releases(
        session, ctx.settings, artist_id, types=types, limit=limit, cursor=cursor
    )
    return _cache(request, page, viewer)


@router.get("/genres", response_model=GenreList)
async def list_genres(request: Request, session: Session, ctx: Ctx) -> Response:
    genres = GenreList(items=await catalog.list_genres(session, ctx.settings))
    return cached_json(request, genres, max_age=3600, public=True, stale_while_revalidate=3600)


@router.get("/moods", response_model=MoodList)
async def list_moods(request: Request, session: Session, ctx: Ctx) -> Response:
    moods = MoodList(items=await catalog.list_moods(session, ctx.settings))
    return cached_json(request, moods, max_age=3600, public=True, stale_while_revalidate=3600)
