"""The viewer's own library: likes, follows, their playlists, listening and search history.

Every mutation is idempotent (liking twice is still one like), so web and Android can retry or
replay offline queues safely; the last write wins, which is the right conflict rule for
set-membership like "is this track liked".
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, ForbiddenError, NotFoundError
from sonora_api.core.ids import uuid7
from sonora_api.models import (
    Artist,
    FollowArtist,
    FollowPlaylist,
    LikeRelease,
    LikeTrack,
    ListeningHistory,
    Playlist,
    PlaylistTrack,
    Release,
    ReleaseArtist,
    SearchHistory,
    Track,
    TrackArtist,
)
from sonora_api.models.enums import PlaylistType, TrackStatus
from sonora_api.models.users import User
from sonora_api.schemas.catalog import ReleaseSummary, TrackOut
from sonora_api.schemas.common import AdminPage
from sonora_api.schemas.editorial import ArtistSummary, PlaylistOut, PlaylistSummary
from sonora_api.schemas.library import (
    DailyMinutes,
    HistoryEntry,
    HistoryOut,
    LibraryIds,
    LikeKind,
    MyStatsOut,
    PopularSearchesOut,
    TopItem,
    UserPlaylistIn,
    UserPlaylistPatch,
)
from sonora_api.services import catalog, editorial

MAX_PLAYLISTS_PER_USER = 500
MAX_PLAYLIST_TRACKS = 5000


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Likes and follows
# ---------------------------------------------------------------------------

_LIKE_MODELS: dict[str, tuple[Any, Any, Any]] = {
    "tracks": (LikeTrack, LikeTrack.track_id, Track),
    "releases": (LikeRelease, LikeRelease.release_id, Release),
    "artists": (FollowArtist, FollowArtist.artist_id, Artist),
    "playlists": (FollowPlaylist, FollowPlaylist.playlist_id, Playlist),
}


async def library_ids(session: AsyncSession, user: User) -> LibraryIds:
    out: dict[str, list[uuid.UUID]] = {}
    for kind, (model, column, _) in _LIKE_MODELS.items():
        rows = await session.scalars(
            select(column).where(model.user_id == user.id).order_by(model.created_at.desc())
        )
        out[kind] = list(rows)
    return LibraryIds(**out)


async def set_saved(
    session: AsyncSession, user: User, kind: LikeKind, target_id: uuid.UUID, saved: bool
) -> None:
    model, column, target_model = _LIKE_MODELS[kind]
    if saved:
        target = await session.get(target_model, target_id)
        if target is None:
            raise NotFoundError("Not found")
        if isinstance(target, Playlist) and not (target.is_public or target.owner_id == user.id):
            raise NotFoundError("Not found")
        await session.execute(
            insert(model).values({"user_id": user.id, column.key: target_id}).on_conflict_do_nothing()
        )
    else:
        await session.execute(delete(model).where(model.user_id == user.id, column == target_id))
    await session.commit()


async def liked_tracks(
    session: AsyncSession, settings: Settings, user: User, offset: int, limit: int
) -> AdminPage[TrackOut]:
    base = (
        catalog._tracks_query(_now())
        .join(LikeTrack, LikeTrack.track_id == Track.id)
        .where(LikeTrack.user_id == user.id)
    )
    total = await session.scalar(select(func.count()).select_from(base.order_by(None).subquery())) or 0
    rows = await session.scalars(base.order_by(LikeTrack.created_at.desc()).offset(offset).limit(limit))
    return AdminPage[TrackOut](
        items=[catalog.track_out(settings, t, user) for t in rows], total=total, offset=offset, limit=limit
    )


async def liked_releases(session: AsyncSession, settings: Settings, user: User) -> list[ReleaseSummary]:
    rows = await session.scalars(
        select(Release)
        .join(LikeRelease, LikeRelease.release_id == Release.id)
        .where(LikeRelease.user_id == user.id, catalog.release_visible(_now()))
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
        .order_by(LikeRelease.created_at.desc())
    )
    return [catalog._release_summary(settings, r) for r in rows]


async def followed_artists(session: AsyncSession, settings: Settings, user: User) -> list[ArtistSummary]:
    rows = await session.scalars(
        select(Artist)
        .join(FollowArtist, FollowArtist.artist_id == Artist.id)
        .where(FollowArtist.user_id == user.id)
        .order_by(FollowArtist.created_at.desc())
    )
    return [editorial.artist_summary(settings, a) for a in rows]


# ---------------------------------------------------------------------------
# The user's playlists
# ---------------------------------------------------------------------------


async def my_playlists(session: AsyncSession, settings: Settings, user: User) -> list[PlaylistSummary]:
    """Own playlists first (most recently changed), then followed public playlists."""
    own = list(
        await session.scalars(
            select(Playlist)
            .where(Playlist.owner_id == user.id, Playlist.type == PlaylistType.USER)
            .order_by(Playlist.updated_at.desc())
        )
    )
    followed = list(
        await session.scalars(
            select(Playlist)
            .join(FollowPlaylist, FollowPlaylist.playlist_id == Playlist.id)
            .where(FollowPlaylist.user_id == user.id, Playlist.is_public)
            .order_by(FollowPlaylist.created_at.desc())
        )
    )
    rows = own + [p for p in followed if p.owner_id != user.id]
    mosaics = await editorial._mosaics(session, settings, [p.id for p in rows])
    owner_ids = {p.owner_id for p in rows if p.owner_id}
    rows_names = await session.execute(select(User.id, User.display_name).where(User.id.in_(owner_ids)))
    names: dict[uuid.UUID, str] = dict(rows_names.all())
    return [
        editorial._playlist_summary(
            settings,
            p,
            mosaics.get(p.id, []),
            None if p.type == PlaylistType.EDITORIAL or p.owner_id is None else names.get(p.owner_id),
        )
        for p in rows
    ]


async def _own(session: AsyncSession, user: User, playlist_id: uuid.UUID) -> Playlist:
    p = await session.get(Playlist, playlist_id)
    if p is None or p.type != PlaylistType.USER:
        raise NotFoundError("Playlist not found")
    if p.owner_id != user.id:
        # Don't reveal private playlists of others; public ones are read-only for non-owners.
        if p.is_public:
            raise ForbiddenError("Only the owner can change this playlist", code="not_owner")
        raise NotFoundError("Playlist not found")
    return p


async def _durations(session: AsyncSession, track_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    known = {
        row.id: row.duration_ms
        for row in await session.execute(select(Track.id, Track.duration_ms).where(Track.id.in_(track_ids)))
    }
    if missing := [str(t) for t in track_ids if t not in known]:
        raise AppError(
            "Unknown tracks", code="validation_error", status_code=422, details={"track_ids": missing}
        )
    return known


async def _write_order(session: AsyncSession, p: Playlist, track_ids: list[uuid.UUID], user: User) -> None:
    """Rewrite entries in the given order (deduplicated); refreshes count and duration."""
    unique = list(dict.fromkeys(track_ids))
    if len(unique) > MAX_PLAYLIST_TRACKS:
        raise AppError("Playlist is full", code="playlist_full", status_code=422)
    known = await _durations(session, unique)
    added_by = {
        row.track_id: row.added_by
        for row in await session.execute(
            select(PlaylistTrack.track_id, PlaylistTrack.added_by).where(PlaylistTrack.playlist_id == p.id)
        )
    }
    await session.execute(delete(PlaylistTrack).where(PlaylistTrack.playlist_id == p.id))
    await session.flush()
    for index, track_id in enumerate(unique):
        session.add(
            PlaylistTrack(
                id=uuid7(),
                playlist_id=p.id,
                track_id=track_id,
                # Zero-padded keys sort correctly under COLLATE "C" and leave gaps for inserts.
                position=f"{(index + 1) * 1000:012d}",
                added_by=added_by.get(track_id, user.id),
            )
        )
    p.track_count = len(unique)
    p.total_duration_ms = sum(known[t] for t in unique)
    p.updated_at = _now()


async def _track_order(session: AsyncSession, p: Playlist) -> list[uuid.UUID]:
    return list(
        await session.scalars(
            select(PlaylistTrack.track_id)
            .where(PlaylistTrack.playlist_id == p.id)
            .order_by(PlaylistTrack.position)
        )
    )


async def create_playlist(session: AsyncSession, user: User, body: UserPlaylistIn) -> Playlist:
    count = await session.scalar(
        select(func.count())
        .select_from(Playlist)
        .where(Playlist.owner_id == user.id, Playlist.type == PlaylistType.USER)
    )
    if (count or 0) >= MAX_PLAYLISTS_PER_USER:
        raise AppError("Too many playlists", code="playlist_limit", status_code=422)
    p = Playlist(
        id=uuid7(),
        owner_id=user.id,
        title=body.title.strip(),
        description=body.description,
        is_public=body.is_public,
        type=PlaylistType.USER,
    )
    session.add(p)
    await session.flush()
    if body.track_ids:
        await _write_order(session, p, body.track_ids, user)
    await session.commit()
    return p


async def update_playlist(
    session: AsyncSession, user: User, playlist_id: uuid.UUID, body: UserPlaylistPatch
) -> Playlist:
    p = await _own(session, user, playlist_id)
    changes = body.model_dump(exclude_unset=True)
    if "title" in changes:
        if not body.title:
            raise AppError("title cannot be empty", code="validation_error", status_code=422)
        p.title = body.title.strip()
    if "description" in changes:
        p.description = body.description
    if "is_public" in changes and body.is_public is not None:
        p.is_public = body.is_public
    if "cover" in changes:
        editorial._apply_cover(p, body.cover)
    p.updated_at = _now()
    await session.commit()
    return p


async def delete_playlist(session: AsyncSession, user: User, playlist_id: uuid.UUID) -> None:
    await session.delete(await _own(session, user, playlist_id))
    await session.commit()


async def add_tracks(
    session: AsyncSession, user: User, playlist_id: uuid.UUID, track_ids: list[uuid.UUID]
) -> Playlist:
    p = await _own(session, user, playlist_id)
    current = await _track_order(session, p)
    await _write_order(session, p, current + [t for t in track_ids if t not in current], user)
    await session.commit()
    return p


async def remove_track(
    session: AsyncSession, user: User, playlist_id: uuid.UUID, track_id: uuid.UUID
) -> Playlist:
    p = await _own(session, user, playlist_id)
    await _write_order(session, p, [t for t in await _track_order(session, p) if t != track_id], user)
    await session.commit()
    return p


async def reorder(
    session: AsyncSession, user: User, playlist_id: uuid.UUID, track_ids: list[uuid.UUID]
) -> Playlist:
    p = await _own(session, user, playlist_id)
    current = await _track_order(session, p)
    if sorted(map(str, track_ids)) != sorted(map(str, current)):
        # A stale client (another device changed the list) must not drop or resurrect tracks.
        raise AppError("The playlist changed; reload it", code="playlist_conflict", status_code=409)
    await _write_order(session, p, track_ids, user)
    await session.commit()
    return p


async def playlist_detail(session: AsyncSession, settings: Settings, user: User, p: Playlist) -> PlaylistOut:
    return await editorial.playlist_out(session, settings, p, user)


# ---------------------------------------------------------------------------
# Histories
# ---------------------------------------------------------------------------


async def listening_history(session: AsyncSession, settings: Settings, user: User, limit: int) -> HistoryOut:
    rows = (
        (
            await session.execute(
                catalog._tracks_query(_now())
                .join(ListeningHistory, ListeningHistory.track_id == Track.id)
                .where(ListeningHistory.user_id == user.id)
                .add_columns(ListeningHistory.played_at, ListeningHistory.ms_played)
                .order_by(ListeningHistory.played_at.desc())
                .limit(limit)
            )
        )
        .unique()
        .all()
    )
    return HistoryOut(
        items=[
            HistoryEntry(played_at=played_at, ms_played=ms, track=catalog.track_out(settings, t, user))
            for t, played_at, ms in rows
        ]
    )


async def clear_listening_history(session: AsyncSession, user: User) -> None:
    await session.execute(delete(ListeningHistory).where(ListeningHistory.user_id == user.id))
    await session.commit()


async def record_search(session: AsyncSession, user: User, query: str) -> None:
    session.add(SearchHistory(id=uuid7(), user_id=user.id, query=query.strip()[:256]))
    await session.commit()


async def search_history(session: AsyncSession, user: User, limit: int = 10) -> list[str]:
    rows = await session.execute(
        select(SearchHistory.query, func.max(SearchHistory.created_at).label("last"))
        .where(SearchHistory.user_id == user.id, SearchHistory.query.is_not(None))
        .group_by(SearchHistory.query)
        .order_by(func.max(SearchHistory.created_at).desc())
        .limit(limit)
    )
    return [q for q, _ in rows if q]


async def clear_search_history(session: AsyncSession, user: User) -> None:
    await session.execute(delete(SearchHistory).where(SearchHistory.user_id == user.id))
    await session.commit()


async def popular_searches(session: AsyncSession, limit: int = 8) -> PopularSearchesOut:
    """What people searched in the last 30 days (asked by ≥ 2 users); until there is enough of
    that, the most played artists — real data either way, never invented."""
    since = _now() - timedelta(days=30)
    rows = await session.execute(
        select(
            func.lower(SearchHistory.query), func.count(func.distinct(SearchHistory.user_id)).label("users")
        )
        .where(SearchHistory.created_at >= since, SearchHistory.query.is_not(None))
        .group_by(func.lower(SearchHistory.query))
        .having(func.count(func.distinct(SearchHistory.user_id)) >= 2)
        .order_by(func.count(func.distinct(SearchHistory.user_id)).desc())
        .limit(limit)
    )
    queries = [q for q, _ in rows if q]
    if len(queries) >= 3:
        return PopularSearchesOut(queries=queries, source="searches")
    top = await session.scalars(
        select(Artist.name)
        .join(TrackArtist, TrackArtist.artist_id == Artist.id)
        .join(Track, Track.id == TrackArtist.track_id)
        .where(Track.status == TrackStatus.READY)
        .group_by(Artist.id, Artist.name)
        .order_by(func.sum(Track.play_count).desc(), Artist.name)
        .limit(limit)
    )
    return PopularSearchesOut(queries=list(top), source="plays")


async def my_stats(session: AsyncSession, user: User, days: int) -> MyStatsOut:
    since = _now() - timedelta(days=days)
    counted = (
        (ListeningHistory.user_id == user.id)
        & ListeningHistory.counted
        & (ListeningHistory.played_at >= since)
    )
    plays, ms, distinct_tracks = (
        await session.execute(
            select(
                func.count(),
                func.coalesce(func.sum(ListeningHistory.ms_played), 0),
                func.count(func.distinct(ListeningHistory.track_id)),
            ).where(counted)
        )
    ).one()
    top_tracks = await session.execute(
        select(Track.id, Track.title, func.count().label("n"))
        .join(ListeningHistory, ListeningHistory.track_id == Track.id)
        .where(counted)
        .group_by(Track.id, Track.title)
        .order_by(func.count().desc(), Track.title)
        .limit(5)
    )
    artist_plays = (
        select(Artist.id, Artist.name, func.count().label("n"))
        .join(TrackArtist, TrackArtist.artist_id == Artist.id)
        .join(ListeningHistory, ListeningHistory.track_id == TrackArtist.track_id)
        .where(counted)
        .group_by(Artist.id, Artist.name)
    )
    top_artists = await session.execute(artist_plays.order_by(func.count().desc(), Artist.name).limit(5))
    distinct_artists = await session.scalar(select(func.count()).select_from(artist_plays.subquery())) or 0
    day = func.date_trunc("day", ListeningHistory.played_at)
    per_day = {
        d.date().isoformat(): int(m // 60_000)
        for d, m in await session.execute(
            select(day, func.sum(ListeningHistory.ms_played)).where(counted).group_by(day)
        )
    }
    today = _now().date()
    daily = [
        DailyMinutes(
            date=(today - timedelta(days=i)).isoformat(),
            minutes=per_day.get((today - timedelta(days=i)).isoformat(), 0),
        )
        for i in range(days - 1, -1, -1)
    ]
    return MyStatsOut(
        days=days,
        plays=plays,
        minutes=int(ms // 60_000),
        distinct_tracks=distinct_tracks,
        distinct_artists=distinct_artists,
        top_tracks=[TopItem(id=i, name=t, plays=n) for i, t, n in top_tracks],
        top_artists=[TopItem(id=i, name=a, plays=n) for i, a, n in top_artists],
        daily=daily,
    )
