"""Catalogue writes performed by the pipeline (synchronous SQLAlchemy session)."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date
from typing import Any

from sonora_api.core.ids import uuid7
from sonora_api.core.slugs import slugify
from sonora_api.media.lyrics import line_document, static_document
from sonora_api.models import (
    Artist,
    Genre,
    Lyrics,
    Release,
    ReleaseArtist,
    Track,
    TrackArtist,
    TrackCredit,
    TrackFeatures,
    TrackFile,
    TrackGenre,
)
from sonora_api.models.enums import (
    ArtistRole,
    CreditRole,
    LyricsSource,
    LyricsType,
    Quality,
    ReleaseStatus,
    ReleaseType,
    SourceFormat,
    TrackStatus,
)
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from sonora_media import fingerprint as fp
from sonora_media.loudness import album_gain
from sonora_media.tags import TrackTags

VARIOUS_ARTISTS = {"various artists", "various", "va", "сборник", "разные исполнители"}


# ---------------------------------------------------------------------------
# Duplicates
# ---------------------------------------------------------------------------


def find_duplicate(
    session: Session, *, sha256: str, fingerprint: str, duration_ms: int, exclude: uuid.UUID | None
) -> tuple[uuid.UUID, str] | None:
    """(existing track id, reason) when this recording is already in the catalogue."""
    same_bytes = select(Track.id).where(Track.source_sha256 == sha256)
    if exclude:
        same_bytes = same_bytes.where(Track.id != exclude)
    if (track_id := session.scalar(same_bytes)) is not None:
        return track_id, "тот же самый файл"

    mine = fp.decode(fingerprint)
    if not fp.is_informative(mine):
        return None
    candidates = select(Track.id, Track.fingerprint).where(
        Track.fingerprint.is_not(None),
        Track.duration_ms.between(
            duration_ms - fp.DURATION_TOLERANCE_MS, duration_ms + fp.DURATION_TOLERANCE_MS
        ),
    )
    if exclude:
        candidates = candidates.where(Track.id != exclude)
    for track_id, other in session.execute(candidates):
        if other is None:
            continue
        theirs = fp.decode(other)
        if not fp.is_informative(theirs):
            continue
        score = fp.similarity(mine, theirs)
        if score >= fp.DUPLICATE_SIMILARITY:
            return track_id, f"та же запись (сходство отпечатков {score:.2f})"
    return None


# ---------------------------------------------------------------------------
# Artists / releases / tracks
# ---------------------------------------------------------------------------


def _unique_slug(session: Session, model: type[Artist], base: str) -> str:
    slug, n = base, 1
    while session.scalar(select(model.id).where(model.slug == slug)) is not None:
        n += 1
        slug = f"{base}-{n}"
    return slug


def get_or_create_artist(session: Session, name: str) -> Artist:
    artist = session.scalar(select(Artist).where(func.lower(Artist.name) == name.lower()).limit(1))
    if artist is not None:
        return artist
    artist = Artist(
        id=uuid7(), name=name, sort_name=name.lower(), slug=_unique_slug(session, Artist, slugify(name))
    )
    session.add(artist)
    session.flush()
    return artist


def infer_release_type(tags: TrackTags, album_artists: Iterable[str]) -> ReleaseType:
    if any(a.lower() in VARIOUS_ARTISTS for a in album_artists):
        return ReleaseType.COMPILATION
    total = tags.track_total
    if total is None:
        return ReleaseType.SINGLE if not tags.album or tags.album == tags.title else ReleaseType.ALBUM
    if total <= 3:
        return ReleaseType.SINGLE
    if total <= 6:
        return ReleaseType.EP
    return ReleaseType.ALBUM


def find_or_create_release(session: Session, tags: TrackTags, main_artist: Artist) -> Release:
    title = tags.album or tags.title or "Untitled"
    if tags.upc and (release := session.scalar(select(Release).where(Release.upc == tags.upc))) is not None:
        return release
    existing = session.scalar(
        select(Release)
        .join(ReleaseArtist, ReleaseArtist.release_id == Release.id)
        .where(
            func.lower(Release.title) == title.lower(),
            ReleaseArtist.artist_id == main_artist.id,
            ReleaseArtist.role == ArtistRole.MAIN,
        )
        .limit(1)
    )
    if existing is not None:
        return existing
    album_artist_names = tags.album_artists or tags.artists
    release = Release(
        id=uuid7(),
        title=title,
        slug=slugify(title),
        type=infer_release_type(tags, album_artist_names),
        release_date=date.fromisoformat(tags.release_date) if tags.release_date else None,
        label=tags.label,
        upc=tags.upc,
        status=ReleaseStatus.DRAFT,
    )
    session.add(release)
    session.flush()
    for position, name in enumerate(album_artist_names):
        artist = (
            main_artist if name.lower() == main_artist.name.lower() else get_or_create_artist(session, name)
        )
        session.add(
            ReleaseArtist(release_id=release.id, artist_id=artist.id, role=ArtistRole.MAIN, position=position)
        )
    session.flush()
    return release


def _next_track_number(session: Session, release_id: uuid.UUID, disc: int) -> int:
    current = session.scalar(
        select(func.max(Track.track_number)).where(Track.release_id == release_id, Track.disc_number == disc)
    )
    return (current or 0) + 1


def upsert_track(
    session: Session,
    *,
    track_id: uuid.UUID | None,
    tags: TrackTags,
    probe: dict[str, Any],
    sha256: str,
    fingerprint: str,
    loudness: dict[str, Any],
) -> Track:
    """Create the track (status `processing`), or refresh it when a job is retried."""
    main_artists = [get_or_create_artist(session, name) for name in tags.artists]
    featured = [get_or_create_artist(session, name) for name in tags.featured]
    release = find_or_create_release(session, tags, main_artists[0])

    existing = session.get(Track, track_id) if track_id else None
    disc = tags.disc_number or 1
    # Compute everything before the row joins the session: any query below would autoflush a
    # half-filled INSERT and violate NOT NULL constraints.
    number = tags.track_number or (
        existing.track_number
        if existing is not None and existing.release_id == release.id
        else _next_track_number(session, release.id, disc)
    )
    track = existing or Track(id=uuid7(), status=TrackStatus.PROCESSING)
    track.track_number = number
    track.release_id = release.id
    track.title = tags.title or "Untitled"
    track.version = tags.version
    track.disc_number = disc
    track.duration_ms = probe["duration_ms"]
    track.isrc = tags.isrc
    track.is_explicit = tags.explicit
    track.source_format = SourceFormat(probe["codec"])
    track.source_bit_depth = probe["bit_depth"]
    track.source_sample_rate = probe["sample_rate"]
    track.source_sha256 = sha256
    track.fingerprint = fingerprint
    track.loudness_lufs = loudness["integrated_lufs"]
    track.true_peak = loudness["true_peak_db"]
    track.track_gain = loudness["track_gain"]
    session.add(track)
    session.flush()

    session.execute(delete(TrackArtist).where(TrackArtist.track_id == track.id))
    links = [(a, ArtistRole.MAIN) for a in main_artists] + [(a, ArtistRole.FEAT) for a in featured]
    for position, (artist, role) in enumerate(links):
        session.add(TrackArtist(track_id=track.id, artist_id=artist.id, role=role, position=position))

    session.execute(delete(TrackCredit).where(TrackCredit.track_id == track.id))
    credit_rows = [(n, CreditRole.COMPOSER) for n in tags.composers] + [
        (n, CreditRole.LYRICIST) for n in tags.lyricists
    ]
    for position, (name, credit_role) in enumerate(credit_rows):
        session.add(
            TrackCredit(id=uuid7(), track_id=track.id, person_name=name, role=credit_role, position=position)
        )

    session.execute(delete(TrackGenre).where(TrackGenre.track_id == track.id))
    for name in tags.genres:
        slug = slugify(name, max_length=64)
        genre = session.scalar(select(Genre).where(Genre.slug == slug))
        if genre is None:
            genre = Genre(id=uuid7(), slug=slug, name=name)
            session.add(genre)
            session.flush()
        session.add(TrackGenre(track_id=track.id, genre_id=genre.id))
    session.flush()
    return track


# ---------------------------------------------------------------------------
# Finalisation
# ---------------------------------------------------------------------------


def lyrics_document(tags: TrackTags, duration_ms: int) -> tuple[LyricsType, dict[str, Any]] | None:
    if tags.synced_lyrics:
        return LyricsType.LINE, line_document(tags.synced_lyrics, duration_ms)
    if tags.lyrics:
        return LyricsType.STATIC, static_document(tags.lyrics)
    return None


def finalize_track(
    session: Session,
    track: Track,
    *,
    renditions: list[dict[str, Any]],
    hls_master_key: str,
    waveform: list[int],
    preview: dict[str, Any],
    lyrics: dict[str, Any] | None,
    artwork: dict[str, Any],
    channels: int,
    publish: bool,
    target_lufs: float,
    peak_ceiling: float,
) -> None:
    session.execute(delete(TrackFile).where(TrackFile.track_id == track.id))
    for r in renditions:
        session.add(
            TrackFile(
                id=uuid7(),
                track_id=track.id,
                quality=Quality(r["quality"]),
                codec=r["codec"],
                bitrate=r["bitrate"],
                sample_rate=r["sample_rate"],
                bit_depth=r["bit_depth"],
                channels=channels,
                storage_key=r["storage_key"],
                hls_playlist_key=r["hls_playlist_key"],
                size_bytes=r["size_bytes"],
                checksum_sha256=r["sha256"],
                encoder_delay=r["encoder_delay"],
                encoder_padding=r["encoder_padding"],
            )
        )

    features = session.get(TrackFeatures, track.id) or TrackFeatures(track_id=track.id)
    features.waveform = waveform
    session.add(features)

    existing_lyrics = session.get(Lyrics, track.id)
    if lyrics is not None:
        row = existing_lyrics or Lyrics(track_id=track.id)
        row.type, row.body, row.source = LyricsType(lyrics["type"]), lyrics["body"], LyricsSource.AUTO
        session.add(row)
        track.has_lyrics, track.lyrics_type = True, LyricsType(lyrics["type"])

    track.hls_master_key = hls_master_key
    track.preview_key = preview["key"]
    track.preview_start_ms = preview["start_ms"]
    track.status = TrackStatus.READY
    session.flush()

    release = session.get(Release, track.release_id)
    assert release is not None  # noqa: S101 - FK guarantees it
    if artwork.get("cover_key"):
        release.cover_key = artwork["cover_key"]
        release.cover_blurhash = artwork["blurhash"]
        release.palette = artwork["palette"]
    refresh_release(session, release, target_lufs=target_lufs, peak_ceiling=peak_ceiling)
    if publish and release.status == ReleaseStatus.DRAFT:
        release.status = ReleaseStatus.PUBLISHED
    session.flush()


def refresh_release(session: Session, release: Release, *, target_lufs: float, peak_ceiling: float) -> None:
    """Recompute aggregates and album gain from all ready tracks of the release."""
    tracks = list(
        session.scalars(
            select(Track).where(Track.release_id == release.id, Track.status == TrackStatus.READY)
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
    gain = album_gain(measured, target=target_lufs, ceiling=peak_ceiling)
    for t in tracks:
        t.album_gain = gain
