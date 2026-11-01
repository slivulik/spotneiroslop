"""Catalogue management from the admin panel: tracks, releases, artists, lyrics."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, NotFoundError
from sonora_api.core.ids import uuid7
from sonora_api.core.slugs import slugify
from sonora_api.media.gain import PEAK_CEILING_DB, TARGET_LUFS, album_gain
from sonora_api.media.lyrics import line_document, parse_lrc, static_document, to_lrc
from sonora_api.models import (
    Artist,
    Genre,
    Lyrics,
    Playlist,
    Release,
    ReleaseArtist,
    Track,
    TrackArtist,
    TrackCredit,
    TrackFile,
    TrackGenre,
)
from sonora_api.models.enums import ArtistRole, LyricsSource, LyricsType, TrackStatus
from sonora_api.schemas.admin_catalog import (
    AdminArtistPatch,
    AdminArtistRow,
    AdminReleaseDetail,
    AdminReleasePatch,
    AdminReleaseRow,
    AdminTrackDetail,
    AdminTrackPatch,
    AdminTrackRow,
    CreditOut,
    FileOut,
    LoudnessOut,
    LyricsAdminOut,
    LyricsIn,
    ReleaseLite,
    SearchHit,
)
from sonora_api.schemas.catalog import ArtistRef
from sonora_api.services.catalog import audio_badges
from sonora_api.services.media import artwork

PAGE = 50


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _track_query() -> Select[Track]:
    return select(Track).options(
        selectinload(Track.release),
        selectinload(Track.artist_links).selectinload(TrackArtist.artist),
    )


def track_row(settings: Settings, t: Track) -> AdminTrackRow:
    r = t.release
    return AdminTrackRow(
        id=t.id,
        title=t.title,
        version=t.version,
        status=t.status,
        duration_ms=t.duration_ms,
        disc_number=t.disc_number,
        track_number=t.track_number,
        is_explicit=t.is_explicit,
        play_count=t.play_count,
        artists=[
            ArtistRef(id=a.artist.id, name=a.artist.name, slug=a.artist.slug, role=a.role)
            for a in t.artist_links
        ],
        release=ReleaseLite(
            id=r.id,
            title=r.title,
            status=r.status,
            artwork=artwork(settings, r.cover_key, blurhash=r.cover_blurhash, palette=r.palette),
        ),
        audio=audio_badges(t),
        has_lyrics=t.has_lyrics,
        lyrics_type=t.lyrics_type,
        created_at=t.created_at,
    )


# ---------------------------------------------------------------------------
# Tracks
# ---------------------------------------------------------------------------


async def list_tracks(
    session: AsyncSession,
    settings: Settings,
    *,
    q: str | None,
    status: TrackStatus | None,
    release_id: uuid.UUID | None,
    offset: int,
    limit: int = PAGE,
) -> tuple[list[AdminTrackRow], int]:
    query = _track_query()
    count = select(func.count()).select_from(Track)
    filters = []
    if q:
        artist_match = select(TrackArtist.track_id).join(Artist).where(Artist.name.ilike(_like(q)))
        filters.append(or_(Track.title.ilike(_like(q)), Track.id.in_(artist_match), Track.isrc == q.upper()))
    if status:
        filters.append(Track.status == status)
    if release_id:
        filters.append(Track.release_id == release_id)
    for f in filters:
        query, count = query.where(f), count.where(f)
    order = (Track.disc_number, Track.track_number) if release_id else (Track.created_at.desc(), Track.id)
    rows = await session.scalars(query.order_by(*order).offset(offset).limit(limit))
    return [track_row(settings, t) for t in rows], int(await session.scalar(count) or 0)


async def _track(session: AsyncSession, track_id: uuid.UUID) -> Track:
    track = await session.scalar(_track_query().where(Track.id == track_id))
    if track is None:
        raise NotFoundError("Track not found")
    return track


async def track_detail(session: AsyncSession, settings: Settings, track_id: uuid.UUID) -> AdminTrackDetail:
    t = await _track(session, track_id)
    genres = list(
        await session.scalars(select(Genre.name).join(TrackGenre).where(TrackGenre.track_id == t.id))
    )
    credit_rows = await session.scalars(
        select(TrackCredit).where(TrackCredit.track_id == t.id).order_by(TrackCredit.position)
    )
    files = await session.scalars(select(TrackFile).where(TrackFile.track_id == t.id))
    lyrics = await session.get(Lyrics, t.id)
    lyrics_out = None
    if lyrics is not None:
        is_line = lyrics.type == LyricsType.LINE
        lyrics_out = LyricsAdminOut(
            type=lyrics.type,
            format="lrc" if is_line else "plain",
            text=to_lrc(lyrics.body) if is_line else str(lyrics.body.get("text", "")),
            language=lyrics.language,
        )
    return AdminTrackDetail(
        **track_row(settings, t).model_dump(),
        isrc=t.isrc,
        genres=genres,
        credits=[CreditOut(name=c.person_name, role=c.role) for c in credit_rows],
        lyrics=lyrics_out,
        files=[
            FileOut(
                quality=f.quality,
                codec=f.codec,
                bitrate=f.bitrate,
                sample_rate=f.sample_rate,
                bit_depth=f.bit_depth,
                size_bytes=f.size_bytes,
            )
            for f in sorted(files, key=lambda f: f.size_bytes, reverse=True)
        ],
        loudness=LoudnessOut(
            lufs=t.loudness_lufs, true_peak=t.true_peak, track_gain=t.track_gain, album_gain=t.album_gain
        ),
    )


async def artist_by_name(session: AsyncSession, name: str) -> Artist:
    name = name.strip()
    artist = await session.scalar(select(Artist).where(func.lower(Artist.name) == name.lower()).limit(1))
    if artist is not None:
        return artist
    base, slug, n = slugify(name), slugify(name), 1
    while await session.scalar(select(Artist.id).where(Artist.slug == slug)):
        n += 1
        slug = f"{base}-{n}"
    artist = Artist(id=uuid7(), name=name, sort_name=name.lower(), slug=slug)
    session.add(artist)
    await session.flush()
    return artist


async def _genre_by_name(session: AsyncSession, name: str) -> Genre:
    slug = slugify(name, max_length=64)
    genre = await session.scalar(select(Genre).where(Genre.slug == slug))
    if genre is None:
        genre = Genre(id=uuid7(), slug=slug, name=name.strip())
        session.add(genre)
        await session.flush()
    return genre


async def update_track(
    session: AsyncSession, settings: Settings, track_id: uuid.UUID, body: AdminTrackPatch
) -> AdminTrackDetail:
    t = await _track(session, track_id)
    changes = body.model_dump(exclude_unset=True)
    for field in ("title", "disc_number", "track_number", "is_explicit"):
        if field in changes:
            if changes[field] is None:
                raise AppError(f"{field} cannot be null", code="validation_error", status_code=422)
            setattr(t, field, changes[field])
    for field in ("version", "isrc"):
        if field in changes:
            setattr(t, field, changes[field] or None)
    if changes.get("status"):
        if t.status in {TrackStatus.PROCESSING, TrackStatus.FAILED} and changes["status"] == "ready":
            raise AppError("Track has not finished processing", code="track_not_processed", status_code=409)
        t.status = TrackStatus(changes["status"])
    await _replace_track_relations(session, t, body)
    t.updated_at = datetime.now(UTC)
    await session.flush()
    await refresh_release(session, t.release_id)
    await session.commit()
    session.expunge_all()
    return await track_detail(session, settings, track_id)


async def _replace_track_relations(session: AsyncSession, t: Track, body: AdminTrackPatch) -> None:
    if body.artists is not None:
        if not any(a.role == ArtistRole.MAIN for a in body.artists):
            raise AppError("At least one main artist is required", code="validation_error", status_code=422)
        await session.execute(delete(TrackArtist).where(TrackArtist.track_id == t.id))
        seen: set[tuple[uuid.UUID, ArtistRole]] = set()
        for position, credit in enumerate(body.artists):
            artist = await artist_by_name(session, credit.name)
            if (artist.id, credit.role) in seen:
                continue
            seen.add((artist.id, credit.role))
            session.add(TrackArtist(track_id=t.id, artist_id=artist.id, role=credit.role, position=position))
    if body.genres is not None:
        await session.execute(delete(TrackGenre).where(TrackGenre.track_id == t.id))
        for name in dict.fromkeys(g.strip() for g in body.genres if g.strip()):
            genre = await _genre_by_name(session, name)
            session.add(TrackGenre(track_id=t.id, genre_id=genre.id))
    if body.credits is not None:
        await session.execute(delete(TrackCredit).where(TrackCredit.track_id == t.id))
        for position, c in enumerate(body.credits):
            session.add(
                TrackCredit(
                    id=uuid7(), track_id=t.id, person_name=c.name.strip(), role=c.role, position=position
                )
            )


async def set_lyrics(session: AsyncSession, track_id: uuid.UUID, body: LyricsIn) -> None:
    t = await session.get(Track, track_id)
    if t is None:
        raise NotFoundError("Track not found")
    if body.format == "lrc":
        lines = parse_lrc(body.text)
        if not lines:
            raise AppError(
                "No timestamped lines found: use [mm:ss.xx] text", code="invalid_lrc", status_code=422
            )
        kind, doc = LyricsType.LINE, line_document(lines, t.duration_ms)
    else:
        kind, doc = LyricsType.STATIC, static_document(body.text)
    row = await session.get(Lyrics, t.id) or Lyrics(track_id=t.id)
    row.type, row.body, row.source, row.language = kind, doc, LyricsSource.MANUAL, body.language
    session.add(row)
    t.has_lyrics, t.lyrics_type = True, kind
    await session.commit()


async def delete_lyrics(session: AsyncSession, track_id: uuid.UUID) -> None:
    t = await session.get(Track, track_id)
    if t is None:
        raise NotFoundError("Track not found")
    await session.execute(delete(Lyrics).where(Lyrics.track_id == t.id))
    t.has_lyrics, t.lyrics_type = False, None
    await session.commit()


async def delete_track(session: AsyncSession, track_id: uuid.UUID) -> str:
    """Delete a track; returns the storage prefix to purge after commit."""
    t = await session.get(Track, track_id)
    if t is None:
        raise NotFoundError("Track not found")
    release_id = t.release_id
    await session.delete(t)
    await session.flush()
    await refresh_release(session, release_id)
    await _refresh_playlist_counters(session)
    await session.commit()
    return f"tracks/{track_id}/"


async def refresh_release(session: AsyncSession, release_id: uuid.UUID) -> None:
    """Recompute aggregates and album gain from the release's ready tracks."""
    release = await session.get(Release, release_id)
    if release is None:
        return
    tracks = list(
        await session.scalars(
            select(Track).where(Track.release_id == release_id, Track.status == TrackStatus.READY)
        )
    )
    release.track_count = len(tracks)
    release.total_duration_ms = sum(t.duration_ms for t in tracks)
    release.is_explicit = any(t.is_explicit for t in tracks)
    measured = [
        (t.loudness_lufs, t.true_peak, t.duration_ms)
        for t in tracks
        if t.loudness_lufs is not None and t.true_peak is not None
    ]
    gain = album_gain(measured, target=TARGET_LUFS, ceiling=PEAK_CEILING_DB)
    for t in tracks:
        t.album_gain = gain


async def _refresh_playlist_counters(session: AsyncSession) -> None:
    from sonora_api.models import PlaylistTrack  # noqa: PLC0415 - local to keep imports grouped by use

    counts = (
        select(PlaylistTrack.playlist_id, func.count().label("n"))
        .group_by(PlaylistTrack.playlist_id)
        .subquery()
    )
    for p, n in await session.execute(
        select(Playlist, counts.c.n).outerjoin(counts, counts.c.playlist_id == Playlist.id)
    ):
        p.track_count = int(n or 0)


# ---------------------------------------------------------------------------
# Releases
# ---------------------------------------------------------------------------


def _release_row(settings: Settings, r: Release) -> AdminReleaseRow:
    return AdminReleaseRow(
        id=r.id,
        title=r.title,
        type=r.type,
        status=r.status,
        release_date=r.release_date,
        publish_at=r.publish_at,
        artwork=artwork(settings, r.cover_key, blurhash=r.cover_blurhash, palette=r.palette),
        artists=[
            ArtistRef(id=a.artist.id, name=a.artist.name, slug=a.artist.slug, role=a.role)
            for a in r.artist_links
        ],
        track_count=r.track_count,
        total_duration_ms=r.total_duration_ms,
        created_at=r.created_at,
    )


def _release_query() -> Select[Release]:
    return select(Release).options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))


async def list_releases(
    session: AsyncSession,
    settings: Settings,
    *,
    q: str | None,
    status: str | None,
    offset: int,
    limit: int = PAGE,
) -> tuple[list[AdminReleaseRow], int]:
    query, count = _release_query(), select(func.count()).select_from(Release)
    if q:
        artist_match = select(ReleaseArtist.release_id).join(Artist).where(Artist.name.ilike(_like(q)))
        f = or_(Release.title.ilike(_like(q)), Release.id.in_(artist_match), Release.upc == q)
        query, count = query.where(f), count.where(f)
    if status:
        query, count = query.where(Release.status == status), count.where(Release.status == status)
    rows = await session.scalars(
        query.order_by(Release.created_at.desc(), Release.id).offset(offset).limit(limit)
    )
    return [_release_row(settings, r) for r in rows], int(await session.scalar(count) or 0)


async def release_detail(
    session: AsyncSession, settings: Settings, release_id: uuid.UUID
) -> AdminReleaseDetail:
    r = await session.scalar(_release_query().where(Release.id == release_id))
    if r is None:
        raise NotFoundError("Release not found")
    tracks, _ = await list_tracks(
        session, settings, q=None, status=None, release_id=release_id, offset=0, limit=500
    )
    return AdminReleaseDetail(
        **_release_row(settings, r).model_dump(), label=r.label, upc=r.upc, tracks=tracks
    )


async def update_release(
    session: AsyncSession, settings: Settings, release_id: uuid.UUID, body: AdminReleasePatch
) -> AdminReleaseDetail:
    r = await session.get(Release, release_id)
    if r is None:
        raise NotFoundError("Release not found")
    changes = body.model_dump(exclude_unset=True)
    for field in ("title", "type", "status"):
        if field in changes:
            if changes[field] is None:
                raise AppError(f"{field} cannot be null", code="validation_error", status_code=422)
            setattr(r, field, changes[field])
    if "title" in changes:
        r.slug = slugify(changes["title"])
    for field in ("release_date", "label", "upc"):
        if field in changes:
            setattr(r, field, changes[field] or None)
    if "publish_at" in changes:
        value = changes["publish_at"]
        r.publish_at = value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value
    if "cover" in changes:
        cover = body.cover
        r.cover_key = cover.key if cover else None
        r.cover_blurhash = cover.blurhash if cover else None
        r.palette = cover.palette.model_dump() if cover and cover.palette else None
    if body.artists is not None:
        await session.execute(delete(ReleaseArtist).where(ReleaseArtist.release_id == r.id))
        added: set[uuid.UUID] = set()
        for position, name in enumerate(body.artists):
            artist = await artist_by_name(session, name)
            if artist.id not in added:
                added.add(artist.id)
                session.add(
                    ReleaseArtist(
                        release_id=r.id, artist_id=artist.id, role=ArtistRole.MAIN, position=position
                    )
                )
    await session.commit()
    session.expunge_all()
    return await release_detail(session, settings, release_id)


async def delete_release(session: AsyncSession, release_id: uuid.UUID) -> list[str]:
    """Delete a release with its tracks; returns storage prefixes to purge after commit."""
    r = await session.get(Release, release_id)
    if r is None:
        raise NotFoundError("Release not found")
    track_ids = list(await session.scalars(select(Track.id).where(Track.release_id == r.id)))
    await session.delete(r)
    await session.flush()
    await _refresh_playlist_counters(session)
    await session.commit()
    return [f"tracks/{t}/" for t in track_ids]


# ---------------------------------------------------------------------------
# Artists
# ---------------------------------------------------------------------------


async def list_artists(
    session: AsyncSession, settings: Settings, *, q: str | None, offset: int, limit: int = PAGE
) -> tuple[list[AdminArtistRow], int]:
    tracks = (
        select(
            TrackArtist.artist_id,
            func.count().label("n"),
            func.coalesce(func.sum(Track.play_count), 0).label("plays"),
        )
        .join(Track)
        .group_by(TrackArtist.artist_id)
        .subquery()
    )
    releases = (
        select(ReleaseArtist.artist_id, func.count().label("n")).group_by(ReleaseArtist.artist_id).subquery()
    )
    query = (
        select(
            Artist,
            func.coalesce(tracks.c.n, 0),
            func.coalesce(releases.c.n, 0),
            func.coalesce(tracks.c.plays, 0),
        )
        .outerjoin(tracks, tracks.c.artist_id == Artist.id)
        .outerjoin(releases, releases.c.artist_id == Artist.id)
    )
    count = select(func.count()).select_from(Artist)
    if q:
        query, count = query.where(Artist.name.ilike(_like(q))), count.where(Artist.name.ilike(_like(q)))
    rows = await session.execute(query.order_by(Artist.name).offset(offset).limit(limit))
    out = [
        AdminArtistRow(
            id=a.id, name=a.name, slug=a.slug, verified=a.verified, bio=a.bio,
            artwork=artwork(settings, a.photo_key, blurhash=a.photo_blurhash, palette=a.palette),
            track_count=int(nt), release_count=int(nr), plays=int(pl),
            photo_credit=a.photo_credit, bio_source=a.bio_source,
        )
        for a, nt, nr, pl in rows
    ]  # fmt: skip
    return out, int(await session.scalar(count) or 0)


async def update_artist(
    session: AsyncSession, settings: Settings, artist_id: uuid.UUID, body: AdminArtistPatch
) -> AdminArtistRow:
    a = await session.get(Artist, artist_id)
    if a is None:
        raise NotFoundError("Artist not found")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name"):
        clash = await session.scalar(
            select(Artist.id).where(func.lower(Artist.name) == changes["name"].lower(), Artist.id != a.id)
        )
        if clash:
            raise AppError("Another artist already has this name", code="name_taken", status_code=409)
        a.name, a.sort_name = changes["name"], changes["name"].lower()
    if "bio" in changes:
        a.bio = changes["bio"] or None
        a.bio_source = changes.get("bio_source") or None  # a hand-written bio has no source
    elif "bio_source" in changes:
        a.bio_source = changes["bio_source"] or None
    if "photo_credit" in changes:
        a.photo_credit = changes["photo_credit"] or None
    elif "photo" in changes:
        a.photo_credit = None  # a new photo invalidates the old attribution
    if changes.get("verified") is not None:
        a.verified = changes["verified"]
    if "photo" in changes:
        photo = body.photo
        a.photo_key = photo.key if photo else None
        a.photo_blurhash = photo.blurhash if photo else None
        a.palette = photo.palette.model_dump() if photo and photo.palette else None
    await session.commit()
    rows, _ = await list_artists(session, settings, q=None, offset=0, limit=1_000_000)
    return next(r for r in rows if r.id == a.id)


# ---------------------------------------------------------------------------
# Picker search
# ---------------------------------------------------------------------------


def _hit_track(settings: Settings, t: Track) -> SearchHit:
    r = t.release
    return SearchHit(
        id=t.id,
        kind="track",
        title=t.title + (f" ({t.version})" if t.version else ""),
        subtitle=", ".join(a.artist.name for a in t.artist_links) + f" · {r.title}",
        artwork=artwork(settings, r.cover_key, blurhash=r.cover_blurhash, palette=r.palette),
    )


def _hit_release(settings: Settings, r: Release) -> SearchHit:
    return SearchHit(
        id=r.id,
        kind="release",
        title=r.title,
        subtitle=", ".join(a.artist.name for a in r.artist_links) + f" · {r.status.value}",
        artwork=artwork(settings, r.cover_key, blurhash=r.cover_blurhash, palette=r.palette),
    )


async def search(
    session: AsyncSession, settings: Settings, q: str, kinds: set[str], limit: int = 20
) -> list[SearchHit]:
    hits: list[SearchHit] = []
    pattern = _like(q)
    if "track" in kinds:
        query = (
            _track_query().where(Track.title.ilike(pattern), Track.status == TrackStatus.READY).limit(limit)
        )
        hits.extend(_hit_track(settings, t) for t in await session.scalars(query))
    if "release" in kinds:
        query_r = _release_query().where(Release.title.ilike(pattern)).limit(limit)
        hits.extend(_hit_release(settings, r) for r in await session.scalars(query_r))
    if "artist" in kinds:
        artists = await session.scalars(select(Artist).where(Artist.name.ilike(pattern)).limit(limit))
        hits.extend(
            SearchHit(id=a.id, kind="artist", title=a.name, subtitle=None,
                      artwork=artwork(settings, a.photo_key, blurhash=a.photo_blurhash))
            for a in artists
        )  # fmt: skip
    if "playlist" in kinds:
        playlists = await session.scalars(select(Playlist).where(Playlist.title.ilike(pattern)).limit(limit))
        hits.extend(
            SearchHit(id=p.id, kind="playlist", title=p.title, subtitle=f"{p.track_count} треков",
                      artwork=artwork(settings, p.cover_key, blurhash=p.cover_blurhash))
            for p in playlists
        )  # fmt: skip
    if "genre" in kinds:
        genres = await session.scalars(select(Genre).where(Genre.name.ilike(pattern)).limit(limit))
        hits.extend(
            SearchHit(
                id=g.id, kind="genre", title=g.name, subtitle=g.slug, artwork=artwork(settings, g.cover_key)
            )
            for g in genres
        )
    return hits


async def lookup(
    session: AsyncSession, settings: Settings, kind: str, ids: list[uuid.UUID]
) -> list[SearchHit]:
    """Resolve ids back to picker items (to show a block's current selection)."""
    if not ids:
        return []
    wanted = set(ids)
    out = [hit for hit in await search(session, settings, "", {kind}, limit=10_000) if hit.id in wanted]
    order = {i: n for n, i in enumerate(ids)}
    return sorted(out, key=lambda h: order.get(h.id, 0))
