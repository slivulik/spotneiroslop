"""/v1/me/library, /v1/me/playlists, histories — the viewer's own music."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from sonora_api.deps import Ctx, CurrentViewer, Session
from sonora_api.routers import API_V1
from sonora_api.schemas.catalog import ReleaseSummary, TrackOut
from sonora_api.schemas.common import ERROR_RESPONSES, AdminPage
from sonora_api.schemas.editorial import ArtistSummary, PlaylistOut, PlaylistSummary
from sonora_api.schemas.library import (
    HistoryOut,
    LibraryIds,
    LikeKind,
    PlaylistOrderIn,
    PlaylistTracksIn,
    PopularSearchesOut,
    SearchHistoryOut,
    SearchQueryIn,
    UserPlaylistIn,
    UserPlaylistPatch,
)
from sonora_api.services import library

router = APIRouter(prefix=API_V1, tags=["library"], responses=ERROR_RESPONSES)
NO_CONTENT = status.HTTP_204_NO_CONTENT


@router.get("/me/library")
async def get_library_ids(viewer: CurrentViewer, session: Session) -> LibraryIds:
    return await library.library_ids(session, viewer.user)


@router.put("/me/library/{kind}/{target_id}", status_code=NO_CONTENT)
async def save(kind: LikeKind, target_id: uuid.UUID, viewer: CurrentViewer, session: Session) -> Response:
    """Like a track or release, follow an artist or playlist. Idempotent."""
    await library.set_saved(session, viewer.user, kind, target_id, saved=True)
    return Response(status_code=NO_CONTENT)


@router.delete("/me/library/{kind}/{target_id}", status_code=NO_CONTENT)
async def unsave(kind: LikeKind, target_id: uuid.UUID, viewer: CurrentViewer, session: Session) -> Response:
    await library.set_saved(session, viewer.user, kind, target_id, saved=False)
    return Response(status_code=NO_CONTENT)


@router.get("/me/library/tracks")
async def get_liked_tracks(
    viewer: CurrentViewer,
    session: Session,
    ctx: Ctx,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> AdminPage[TrackOut]:
    return await library.liked_tracks(session, ctx.settings, viewer.user, offset, limit)


@router.get("/me/library/releases")
async def get_liked_releases(viewer: CurrentViewer, session: Session, ctx: Ctx) -> list[ReleaseSummary]:
    return await library.liked_releases(session, ctx.settings, viewer.user)


@router.get("/me/library/artists")
async def get_followed_artists(viewer: CurrentViewer, session: Session, ctx: Ctx) -> list[ArtistSummary]:
    return await library.followed_artists(session, ctx.settings, viewer.user)


@router.get("/me/playlists")
async def list_playlists(viewer: CurrentViewer, session: Session, ctx: Ctx) -> list[PlaylistSummary]:
    return await library.my_playlists(session, ctx.settings, viewer.user)


@router.post("/me/playlists", status_code=status.HTTP_201_CREATED)
async def create_playlist(
    body: UserPlaylistIn, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    p = await library.create_playlist(session, viewer.user, body)
    return await library.playlist_detail(session, ctx.settings, viewer.user, p)


@router.patch("/me/playlists/{playlist_id}")
async def update_playlist(
    playlist_id: uuid.UUID, body: UserPlaylistPatch, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    p = await library.update_playlist(session, viewer.user, playlist_id, body)
    return await library.playlist_detail(session, ctx.settings, viewer.user, p)


@router.delete("/me/playlists/{playlist_id}", status_code=NO_CONTENT)
async def delete_playlist(playlist_id: uuid.UUID, viewer: CurrentViewer, session: Session) -> Response:
    await library.delete_playlist(session, viewer.user, playlist_id)
    return Response(status_code=NO_CONTENT)


@router.post("/me/playlists/{playlist_id}/tracks")
async def add_playlist_tracks(
    playlist_id: uuid.UUID, body: PlaylistTracksIn, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    """Append tracks (already present ones are skipped)."""
    p = await library.add_tracks(session, viewer.user, playlist_id, body.track_ids)
    return await library.playlist_detail(session, ctx.settings, viewer.user, p)


@router.delete("/me/playlists/{playlist_id}/tracks/{track_id}")
async def remove_playlist_track(
    playlist_id: uuid.UUID, track_id: uuid.UUID, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    p = await library.remove_track(session, viewer.user, playlist_id, track_id)
    return await library.playlist_detail(session, ctx.settings, viewer.user, p)


@router.put("/me/playlists/{playlist_id}/order")
async def reorder_playlist(
    playlist_id: uuid.UUID, body: PlaylistOrderIn, viewer: CurrentViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    """Full new order; 409 `playlist_conflict` if the set of tracks changed elsewhere meanwhile."""
    p = await library.reorder(session, viewer.user, playlist_id, body.track_ids)
    return await library.playlist_detail(session, ctx.settings, viewer.user, p)


@router.get("/me/history")
async def get_history(
    viewer: CurrentViewer, session: Session, ctx: Ctx, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> HistoryOut:
    return await library.listening_history(session, ctx.settings, viewer.user, limit)


@router.delete("/me/history", status_code=NO_CONTENT)
async def clear_history(viewer: CurrentViewer, session: Session) -> Response:
    await library.clear_listening_history(session, viewer.user)
    return Response(status_code=NO_CONTENT)


@router.get("/me/search-history")
async def get_search_history(viewer: CurrentViewer, session: Session) -> SearchHistoryOut:
    return SearchHistoryOut(queries=await library.search_history(session, viewer.user))


@router.post("/me/search-history", status_code=NO_CONTENT)
async def add_search_history(body: SearchQueryIn, viewer: CurrentViewer, session: Session) -> Response:
    await library.record_search(session, viewer.user, body.query)
    return Response(status_code=NO_CONTENT)


@router.delete("/me/search-history", status_code=NO_CONTENT)
async def clear_search_history(viewer: CurrentViewer, session: Session) -> Response:
    await library.clear_search_history(session, viewer.user)
    return Response(status_code=NO_CONTENT)


@router.get("/search/popular")
async def popular_searches(session: Session) -> PopularSearchesOut:
    return await library.popular_searches(session)
