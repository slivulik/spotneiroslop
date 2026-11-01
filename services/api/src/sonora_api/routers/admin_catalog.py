import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Query, status

from sonora_api.core.context import AppContext
from sonora_api.core.logging import get_logger
from sonora_api.deps import AdminViewer, Ctx, Session
from sonora_api.models.enums import ReleaseStatus, TrackStatus
from sonora_api.routers import API_V1
from sonora_api.schemas.admin_catalog import (
    AdminArtistPatch,
    AdminArtistRow,
    AdminReleaseDetail,
    AdminReleasePatch,
    AdminReleaseRow,
    AdminTrackDetail,
    AdminTrackPatch,
    AdminTrackRow,
    ArtistSuggestion,
    CoverSuggestion,
    LyricsIn,
    LyricsSuggestion,
    SearchHit,
)
from sonora_api.schemas.common import ERROR_RESPONSES, AdminPage
from sonora_api.services import admin_catalog
from sonora_api.services import lookup as metadata

router = APIRouter(prefix=f"{API_V1}/admin", tags=["admin"], responses=ERROR_RESPONSES)
log = get_logger("sonora.admin")
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=200)]


async def _purge(ctx: AppContext, prefixes: list[str]) -> None:
    """Remove deleted tracks' audio/HLS/previews from storage (after the DB commit)."""
    for prefix in prefixes:
        try:
            removed = await ctx.storage.delete_prefix(ctx.settings.s3_media_bucket, prefix)
            log.info("storage_purged", prefix=prefix, objects=removed)
        except Exception:
            log.exception("storage_purge_failed", prefix=prefix)


# --- tracks ------------------------------------------------------------------------------


@router.get("/tracks")
async def list_tracks(
    admin: AdminViewer,
    session: Session,
    ctx: Ctx,
    q: str | None = None,
    status_filter: Annotated[TrackStatus | None, Query(alias="status")] = None,
    release_id: uuid.UUID | None = None,
    offset: Offset = 0,
    limit: Limit = 50,
) -> AdminPage[AdminTrackRow]:
    items, total = await admin_catalog.list_tracks(
        session, ctx.settings, q=q, status=status_filter, release_id=release_id, offset=offset, limit=limit
    )
    return AdminPage(items=items, total=total, offset=offset, limit=limit)


@router.get("/tracks/{track_id}")
async def get_track(track_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx) -> AdminTrackDetail:
    return await admin_catalog.track_detail(session, ctx.settings, track_id)


@router.patch("/tracks/{track_id}")
async def update_track(
    track_id: uuid.UUID, body: AdminTrackPatch, admin: AdminViewer, session: Session, ctx: Ctx
) -> AdminTrackDetail:
    return await admin_catalog.update_track(session, ctx.settings, track_id, body)


@router.put("/tracks/{track_id}/lyrics")
async def put_lyrics(
    track_id: uuid.UUID, body: LyricsIn, admin: AdminViewer, session: Session, ctx: Ctx
) -> AdminTrackDetail:
    """Plain text, or LRC (`[mm:ss.xx] line`) for line-synced lyrics."""
    await admin_catalog.set_lyrics(session, track_id, body)
    return await admin_catalog.track_detail(session, ctx.settings, track_id)


@router.post("/tracks/{track_id}/lyrics/lookup")
async def lookup_lyrics(track_id: uuid.UUID, admin: AdminViewer, session: Session) -> LyricsSuggestion:
    """Search LRCLIB (synced first). Nothing is saved; 404 `nothing_found` when there is no match."""
    return await metadata.track_lyrics(session, track_id)


@router.delete("/tracks/{track_id}/lyrics", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lyrics(track_id: uuid.UUID, admin: AdminViewer, session: Session) -> None:
    await admin_catalog.delete_lyrics(session, track_id)


@router.delete("/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_track(
    track_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx, tasks: BackgroundTasks
) -> None:
    """Delete a track and its files."""
    prefix = await admin_catalog.delete_track(session, track_id)
    tasks.add_task(_purge, ctx, [prefix])


# --- releases ----------------------------------------------------------------------------


@router.get("/releases")
async def list_releases(
    admin: AdminViewer,
    session: Session,
    ctx: Ctx,
    q: str | None = None,
    status_filter: Annotated[ReleaseStatus | None, Query(alias="status")] = None,
    offset: Offset = 0,
    limit: Limit = 50,
) -> AdminPage[AdminReleaseRow]:
    items, total = await admin_catalog.list_releases(
        session,
        ctx.settings,
        q=q,
        status=status_filter.value if status_filter else None,
        offset=offset,
        limit=limit,
    )
    return AdminPage(items=items, total=total, offset=offset, limit=limit)


@router.get("/releases/{release_id}")
async def get_release(
    release_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx
) -> AdminReleaseDetail:
    return await admin_catalog.release_detail(session, ctx.settings, release_id)


@router.patch("/releases/{release_id}")
async def update_release(
    release_id: uuid.UUID, body: AdminReleasePatch, admin: AdminViewer, session: Session, ctx: Ctx
) -> AdminReleaseDetail:
    """Edit metadata, cover, artists; publish/hide; set an embargo (`publish_at`)."""
    return await admin_catalog.update_release(session, ctx.settings, release_id, body)


@router.delete("/releases/{release_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_release(
    release_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx, tasks: BackgroundTasks
) -> None:
    """Delete a release with all its tracks and files."""
    tasks.add_task(_purge, ctx, await admin_catalog.delete_release(session, release_id))


@router.post("/releases/{release_id}/cover/lookup")
async def lookup_cover(
    release_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx
) -> CoverSuggestion:
    """Find the front cover in MusicBrainz / Cover Art Archive; apply it with PATCH."""
    return await metadata.release_cover(session, ctx, release_id)


# --- artists -----------------------------------------------------------------------------


@router.get("/artists")
async def list_artists(
    admin: AdminViewer,
    session: Session,
    ctx: Ctx,
    q: str | None = None,
    offset: Offset = 0,
    limit: Limit = 50,
) -> AdminPage[AdminArtistRow]:
    items, total = await admin_catalog.list_artists(session, ctx.settings, q=q, offset=offset, limit=limit)
    return AdminPage(items=items, total=total, offset=offset, limit=limit)


@router.patch("/artists/{artist_id}")
async def update_artist(
    artist_id: uuid.UUID, body: AdminArtistPatch, admin: AdminViewer, session: Session, ctx: Ctx
) -> AdminArtistRow:
    return await admin_catalog.update_artist(session, ctx.settings, artist_id, body)


@router.post("/artists/{artist_id}/lookup")
async def lookup_artist(
    artist_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx
) -> ArtistSuggestion:
    """Photo from Wikimedia Commons and a summary from Wikipedia via Wikidata; apply with PATCH."""
    return await metadata.artist_info(session, ctx, artist_id)


# --- pickers -----------------------------------------------------------------------------

Kind = Literal["track", "release", "artist", "playlist", "genre"]


@router.get("/search")
async def search(
    admin: AdminViewer,
    session: Session,
    ctx: Ctx,
    q: Annotated[str, Query(max_length=100)] = "",
    kinds: Annotated[list[Kind] | None, Query(alias="kind")] = None,
) -> list[SearchHit]:
    return await admin_catalog.search(session, ctx.settings, q, set(kinds or ["track", "release", "artist"]))


@router.get("/lookup")
async def lookup(
    admin: AdminViewer,
    session: Session,
    ctx: Ctx,
    kind: Kind,
    ids: Annotated[list[uuid.UUID], Query(alias="id", max_length=100)],
) -> list[SearchHit]:
    return await admin_catalog.lookup(session, ctx.settings, kind, ids)
