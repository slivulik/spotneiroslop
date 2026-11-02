"""Catalogue-wide metadata pass: covers, synced lyrics, artist photos/bios for what already exists.

Runs as one background job (actor `enrich_catalog`), politely rate-limited by the source modules.
Never overwrites what people entered: manual lyrics stay, existing covers stay; plain lyrics found
automatically are upgraded when a synced version exists. Progress is written to the
`enrich_status` platform setting so the admin panel can show it.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sonora_api.enrich import covers, lrclib
from sonora_api.media.lyrics import line_document, parse_lrc, static_document
from sonora_api.models import Artist, Lyrics, PlatformSetting, Release, ReleaseArtist, Track, TrackArtist
from sonora_api.models.enums import LyricsSource, LyricsType, TrackStatus
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from sonora_media import artwork, enrich
from sonora_media.config import WorkerSettings
from sonora_media.logs import get_logger
from sonora_media.storage import MediaStorage, upload_dir

log = get_logger(__name__)
STATUS_KEY = "enrich_status"


@dataclass
class Env:
    """What the enrichment helpers need (the same attribute names as a job context)."""

    settings: WorkerSettings
    storage: MediaStorage
    sessions: sessionmaker[Session]
    workdir: Path


@dataclass
class Report:
    covers: int = 0
    lyrics_synced: int = 0
    lyrics_plain: int = 0
    artists: int = 0
    checked_releases: int = 0
    checked_tracks: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if k != "errors"} | {"errors": self.errors[-5:]}


def _status(env: Env, **values: Any) -> None:
    with env.sessions.begin() as session:
        row = session.get(PlatformSetting, STATUS_KEY) or PlatformSetting(key=STATUS_KEY, value={})
        row.value = {**(row.value or {}), **values}
        session.add(row)


def _first_artist(session: Session, release_id: uuid.UUID) -> str | None:
    return session.scalar(
        select(Artist.name)
        .join(ReleaseArtist)
        .where(ReleaseArtist.release_id == release_id)
        .order_by(ReleaseArtist.position)
        .limit(1)
    )


def fill_covers(env: Env, report: Report) -> None:
    with env.sessions() as session:
        releases = session.scalars(select(Release).where(Release.cover_key.is_(None))).all()
    for release in releases:
        report.checked_releases += 1
        try:
            with env.sessions() as session:
                artist = _first_artist(session, release.id)
                single = (
                    session.scalar(select(Track.title).where(Track.release_id == release.id).limit(1))
                    if (release.track_count or 0) <= 1
                    else None
                )
            if not artist:
                continue
            match = covers.find(
                artist, release.title, track_count=release.track_count or None, single_title=single
            )
            if match is None:
                continue
            out = env.workdir / f"cover-{release.id}"
            result = artwork.process(match.data, out)
            key = f"covers/{release.id}/{hashlib.sha256(match.data).hexdigest()[:12]}"
            upload_dir(env.storage, env.settings.s3_public_bucket, key, out)
            with env.sessions.begin() as session:
                row = session.get(Release, release.id)
                if row is not None and row.cover_key is None:
                    info = result.to_dict()
                    row.cover_key, row.cover_blurhash, row.palette = (
                        key,
                        info.get("blurhash"),
                        info.get("palette"),
                    )
                    report.covers += 1
        except Exception as exc:  # one bad release never stops the pass
            report.errors.append(f"cover {release.id}: {exc}")
            log.warning("backfill_cover_failed", release_id=str(release.id), exc_info=True)


def fill_lyrics(env: Env, report: Report) -> None:
    """Tracks without lyrics, or with automatically found plain lyrics: look for synced ones first."""
    with env.sessions() as session:
        rows = session.execute(
            select(Track.id, Track.title, Track.duration_ms, Release.title, Lyrics.type, Lyrics.source)
            .join(Release, Release.id == Track.release_id)
            .outerjoin(Lyrics, Lyrics.track_id == Track.id)
            .where(Track.status == TrackStatus.READY)
            .where(
                or_(
                    Lyrics.track_id.is_(None),
                    (Lyrics.type == LyricsType.STATIC) & (Lyrics.source != LyricsSource.MANUAL),
                )
            )
        ).all()
    for track_id, title, duration_ms, album, kind, _source in rows:
        report.checked_tracks += 1
        try:
            with env.sessions() as session:
                artist = session.scalar(
                    select(Artist.name)
                    .join(TrackArtist)
                    .where(TrackArtist.track_id == track_id)
                    .order_by(TrackArtist.position)
                    .limit(1)
                )
            if not artist:
                continue
            match = lrclib.find(artist, title, album, duration_ms / 1000)
            if match is None or match.instrumental:
                continue
            lines = parse_lrc(match.synced) if match.synced else []
            if lines:
                doc, new_type = line_document(lines, duration_ms), LyricsType.LINE
            elif match.plain and kind is None:
                doc, new_type = static_document(match.plain), LyricsType.STATIC
            else:
                continue
            with env.sessions.begin() as session:
                row = session.get(Lyrics, track_id)
                if row is not None and row.source == LyricsSource.MANUAL:
                    continue  # edited by a person meanwhile
                row = row or Lyrics(track_id=track_id)
                row.type, row.body, row.source = new_type, doc, LyricsSource.AUTO
                session.add(row)
                track = session.get(Track, track_id)
                if track is not None:
                    track.has_lyrics, track.lyrics_type = True, new_type
            if new_type == LyricsType.LINE:
                report.lyrics_synced += 1
            else:
                report.lyrics_plain += 1
        except Exception as exc:
            report.errors.append(f"lyrics {track_id}: {exc}")
            log.warning("backfill_lyrics_failed", track_id=str(track_id), exc_info=True)


def fill_artists(env: Env, report: Report) -> None:
    with env.sessions() as session:
        ids = list(session.scalars(select(Artist.id).where(Artist.enriched_at.is_(None))))
    for artist_id in ids:
        enrich.artists(env, [artist_id])  # type: ignore[arg-type]  # Env has the same attributes as a job context
        with env.sessions() as session:
            a = session.get(Artist, artist_id)
            if a is not None and (a.photo_key or a.bio):
                report.artists += 1


def run(env: Env) -> Report:
    report = Report()
    env.workdir.mkdir(parents=True, exist_ok=True)
    _status(env, running=True, started_at=datetime.now(UTC).isoformat(), finished_at=None, report=None)
    try:
        for step in (fill_covers, fill_lyrics, fill_artists):
            step(env, report)
            _status(env, report=report.as_dict())
    finally:
        _status(env, running=False, finished_at=datetime.now(UTC).isoformat(), report=report.as_dict())
    log.info("backfill_finished", **report.as_dict())
    return report
