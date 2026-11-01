"""Read side of the catalogue. Everything here returns only content listeners may see."""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime

from sqlalchemy import ColumnElement, Select, and_, exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, selectinload

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, NotFoundError
from sonora_api.core.pagination import decode_cursor, encode_cursor
from sonora_api.models import Artist, Genre, Mood, Release, ReleaseArtist, Track, TrackArtist, TrackGenre
from sonora_api.models.enums import ArtistRole, ReleaseStatus, ReleaseType, SourceFormat, TrackStatus
from sonora_api.models.users import User
from sonora_api.schemas.catalog import (
    ArtistOut,
    ArtistRef,
    AudioBadges,
    GenreOut,
    GenreRef,
    MoodOut,
    ReleaseOut,
    ReleaseRef,
    ReleaseSummary,
    TrackOut,
)
from sonora_api.schemas.common import Page
from sonora_api.services.media import artwork, media_url, palette_out

TOP_TRACKS_LIMIT = 10
HIRES_MIN_BIT_DEPTH = 24
HIRES_MIN_SAMPLE_RATE = 48_000
_MIN_DATE = date(1, 1, 1)


def release_visible(now: datetime) -> ColumnElement[bool]:
    return and_(
        Release.status == ReleaseStatus.PUBLISHED,
        or_(Release.publish_at.is_(None), Release.publish_at <= now),
    )


def track_visible(now: datetime) -> ColumnElement[bool]:
    """Requires `Release` to be joined."""
    return and_(Track.status == TrackStatus.READY, release_visible(now))


def _tracks_query(now: datetime) -> Select[Track]:
    return (
        select(Track)
        .join(Track.release)
        .where(track_visible(now))
        .options(
            contains_eager(Track.release),
            selectinload(Track.artist_links).selectinload(TrackArtist.artist),
        )
    )


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------


def _artist_refs(links: Sequence[TrackArtist | ReleaseArtist]) -> list[ArtistRef]:
    return [
        ArtistRef(id=link.artist.id, name=link.artist.name, slug=link.artist.slug, role=link.role)
        for link in links
    ]


def _release_ref(settings: Settings, release: Release) -> ReleaseRef:
    return ReleaseRef(
        id=release.id,
        title=release.title,
        slug=release.slug,
        type=release.type,
        artwork=artwork(
            settings, release.cover_key, blurhash=release.cover_blurhash, palette=release.palette
        ),
    )


def audio_badges(track: Track) -> AudioBadges:
    lossless = track.source_format == SourceFormat.FLAC
    hires = (
        lossless
        and (track.source_bit_depth or 0) >= HIRES_MIN_BIT_DEPTH
        and (track.source_sample_rate or 0) >= HIRES_MIN_SAMPLE_RATE
    )
    return AudioBadges(lossless=lossless, hires=hires)


def is_playable(track: Track, viewer: User | None) -> bool:
    if viewer is None:
        return False
    return not (viewer.explicit_filter and track.is_explicit)


def track_out(settings: Settings, track: Track, viewer: User | None) -> TrackOut:
    return TrackOut(
        id=track.id,
        title=track.title,
        version=track.version,
        duration_ms=track.duration_ms,
        disc_number=track.disc_number,
        track_number=track.track_number,
        is_explicit=track.is_explicit,
        artists=_artist_refs(track.artist_links),
        release=_release_ref(settings, track.release),
        audio=audio_badges(track),
        has_lyrics=track.has_lyrics,
        lyrics_type=track.lyrics_type,
        has_canvas=track.has_canvas,
        playable=is_playable(track, viewer),
    )


def _release_summary(settings: Settings, release: Release) -> ReleaseSummary:
    return ReleaseSummary(
        id=release.id,
        title=release.title,
        slug=release.slug,
        type=release.type,
        release_date=release.release_date,
        is_explicit=release.is_explicit,
        artwork=artwork(
            settings, release.cover_key, blurhash=release.cover_blurhash, palette=release.palette
        ),
        artists=_artist_refs(release.artist_links),
        track_count=release.track_count,
    )


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


async def get_track(
    session: AsyncSession, settings: Settings, track_id: uuid.UUID, viewer: User | None
) -> TrackOut:
    track = await session.scalar(_tracks_query(_now()).where(Track.id == track_id))
    if track is None:
        raise NotFoundError("Track not found")
    return track_out(settings, track, viewer)


async def get_tracks(
    session: AsyncSession, settings: Settings, ids: list[uuid.UUID], viewer: User | None
) -> list[TrackOut]:
    """Batch lookup; preserves request order and silently skips unknown/hidden ids."""
    if not ids:
        return []
    tracks = {t.id: t for t in await session.scalars(_tracks_query(_now()).where(Track.id.in_(ids)))}
    return [track_out(settings, tracks[i], viewer) for i in dict.fromkeys(ids) if i in tracks]


async def get_release(
    session: AsyncSession, settings: Settings, release_id: uuid.UUID, viewer: User | None
) -> ReleaseOut:
    now = _now()
    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id, release_visible(now))
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
    )
    if release is None:
        raise NotFoundError("Release not found")
    tracks = await session.scalars(
        _tracks_query(now)
        .where(Track.release_id == release_id)
        .order_by(Track.disc_number, Track.track_number)
    )
    track_list = [track_out(settings, t, viewer) for t in tracks]
    genre_rows = await session.execute(
        select(Genre.id, Genre.slug, Genre.name)
        .join(TrackGenre, TrackGenre.genre_id == Genre.id)
        .join(Track, Track.id == TrackGenre.track_id)
        .where(Track.release_id == release_id)
        .group_by(Genre.id, Genre.slug, Genre.name)
        .order_by(func.count().desc(), Genre.name)
    )
    return ReleaseOut(
        **_release_summary(settings, release).model_dump(exclude={"track_count"}),
        label=release.label,
        upc=release.upc,
        total_duration_ms=sum(t.duration_ms for t in track_list),
        track_count=len(track_list),
        tracks=track_list,
        genres=[GenreRef(id=i, slug=sl, name=n) for i, sl, n in genre_rows],
    )


async def _get_artist_row(session: AsyncSession, artist_id: uuid.UUID) -> Artist:
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise NotFoundError("Artist not found")
    return artist


async def get_artist(session: AsyncSession, settings: Settings, artist_id: uuid.UUID) -> ArtistOut:
    artist = await _get_artist_row(session, artist_id)
    return ArtistOut(
        id=artist.id,
        name=artist.name,
        slug=artist.slug,
        bio=artist.bio,
        artwork=artwork(settings, artist.photo_key, blurhash=artist.photo_blurhash, palette=artist.palette),
        header_video_url=media_url(settings, artist.header_video_key) if artist.header_video_key else None,
        palette=palette_out(artist.palette),
        monthly_listeners=artist.monthly_listeners,
        verified=artist.verified,
        photo_credit=artist.photo_credit,
        bio_source=artist.bio_source,
    )


async def get_artist_top_tracks(
    session: AsyncSession, settings: Settings, artist_id: uuid.UUID, viewer: User | None
) -> list[TrackOut]:
    await _get_artist_row(session, artist_id)
    performer = (
        select(TrackArtist.track_id)
        .where(TrackArtist.artist_id == artist_id, TrackArtist.role.in_([ArtistRole.MAIN, ArtistRole.FEAT]))
        .scalar_subquery()
    )
    tracks = await session.scalars(
        _tracks_query(_now())
        .where(Track.id.in_(performer))
        .order_by(Track.play_count.desc(), Track.id)
        .limit(TOP_TRACKS_LIMIT)
    )
    return [track_out(settings, t, viewer) for t in tracks]


_RELEASE_CURSOR_KEYS = frozenset({"d", "id"})


async def get_artist_releases(
    session: AsyncSession,
    settings: Settings,
    artist_id: uuid.UUID,
    *,
    types: list[ReleaseType] | None,
    limit: int,
    cursor: str | None,
) -> Page[ReleaseSummary]:
    await _get_artist_row(session, artist_id)
    sort_date = func.coalesce(Release.release_date, _MIN_DATE)
    query = (
        select(Release)
        .join(ReleaseArtist, ReleaseArtist.release_id == Release.id)
        .where(
            ReleaseArtist.artist_id == artist_id,
            ReleaseArtist.role == ArtistRole.MAIN,
            release_visible(_now()),
        )
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
        .order_by(sort_date.desc(), Release.id.desc())
        .limit(limit + 1)
    )
    if types:
        query = query.where(Release.type.in_(types))
    if (after := decode_cursor(cursor, keys=_RELEASE_CURSOR_KEYS)) is not None:
        try:
            after_date, after_id = date.fromisoformat(after["d"]), uuid.UUID(after["id"])
        except (TypeError, ValueError):
            raise AppError("Malformed cursor", code="invalid_cursor") from None
        query = query.where(tuple_(sort_date, Release.id) < tuple_(after_date, after_id))

    rows = list(await session.scalars(query))
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = encode_cursor({"d": (last.release_date or _MIN_DATE).isoformat(), "id": str(last.id)})
    return Page(items=[_release_summary(settings, r) for r in rows], next_cursor=next_cursor)


async def list_new_releases(
    session: AsyncSession, settings: Settings, *, limit: int, cursor: str | None
) -> Page[ReleaseSummary]:
    """Published releases, newest first (by release date, then upload order)."""
    sort_date = func.coalesce(Release.release_date, _MIN_DATE)
    query = (
        select(Release)
        .where(
            release_visible(_now()),
            # Real availability, not the denormalised counter.
            exists().where(Track.release_id == Release.id, Track.status == TrackStatus.READY),
        )
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
        .order_by(sort_date.desc(), Release.id.desc())
        .limit(limit + 1)
    )
    if (after := decode_cursor(cursor, keys=_RELEASE_CURSOR_KEYS)) is not None:
        try:
            after_date, after_id = date.fromisoformat(after["d"]), uuid.UUID(after["id"])
        except (TypeError, ValueError):
            raise AppError("Malformed cursor", code="invalid_cursor") from None
        query = query.where(tuple_(sort_date, Release.id) < tuple_(after_date, after_id))
    rows = list(await session.scalars(query))
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = encode_cursor({"d": (last.release_date or _MIN_DATE).isoformat(), "id": str(last.id)})
    return Page(items=[_release_summary(settings, r) for r in rows], next_cursor=next_cursor)


async def list_genres(session: AsyncSession, settings: Settings) -> list[GenreOut]:
    genres = await session.scalars(select(Genre).order_by(Genre.position, Genre.name))
    return [
        GenreOut(
            id=g.id,
            slug=g.slug,
            name=g.name,
            parent_id=g.parent_id,
            color=g.color,
            artwork=artwork(settings, g.cover_key),
        )
        for g in genres
    ]


async def list_moods(session: AsyncSession, settings: Settings) -> list[MoodOut]:
    moods = await session.scalars(select(Mood).order_by(Mood.position, Mood.name))
    return [
        MoodOut(id=m.id, slug=m.slug, name=m.name, color=m.color, artwork=artwork(settings, m.cover_key))
        for m in moods
    ]
