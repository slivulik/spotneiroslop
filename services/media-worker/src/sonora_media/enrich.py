"""Fill gaps from open databases during processing (best effort: never fails a job)."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sonora_api.enrich import covers, lrclib, musicbrainz, wikimedia
from sonora_api.media.images import ImageError, process
from sonora_api.media.lyrics import line_document, parse_lrc, static_document
from sonora_api.models import Artist, PlatformSetting
from sonora_api.models.enums import LyricsType
from sqlalchemy import select

from sonora_media.logs import get_logger
from sonora_media.storage import upload_dir

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from sonora_media.pipeline import JobContext

log = get_logger(__name__)


def enabled(ctx: JobContext) -> bool:
    if not ctx.settings.metadata_lookup:
        return False
    with ctx.sessions() as session:
        row = session.get(PlatformSetting, "config")
        return bool((row.value if row else {}).get("metadata_lookup", True))


def lyrics(ctx: JobContext) -> dict[str, Any] | None:
    tags = ctx.tags
    if not (tags.artists and tags.title):
        return None
    match = lrclib.find(tags.artists[0], tags.title, tags.album, ctx.probe.duration_ms / 1000)
    if match is None or match.instrumental:
        return None
    if match.synced:
        lines = parse_lrc(match.synced)
        if lines:
            return {"type": LyricsType.LINE.value, "body": line_document(lines, ctx.probe.duration_ms)}
    if match.plain:
        return {"type": LyricsType.STATIC.value, "body": static_document(match.plain)}
    return None


def cover(ctx: JobContext) -> bytes | None:
    tags = ctx.tags
    if not tags.artists:
        return None
    album = tags.album or tags.title  # a lone track without an album tag is its own single
    if not album:
        return None
    single = tags.title if (tags.track_total or 1) <= 1 or not tags.album else None
    match = covers.find(tags.artists[0], album, track_count=tags.track_total, single_title=single)
    return match.data if match else None


def apply_artist_info(session: Session, ctx: JobContext, artist: Artist, workdir: Path) -> None:
    """Find a photo and a biography for an artist who has neither (once per artist)."""
    artist.enriched_at = datetime.now(UTC)
    qid = musicbrainz.find_artist_wikidata(artist.name)
    info = wikimedia.artist_info(qid) if qid else None
    if info is None:
        return
    if info.photo and not artist.photo_key:
        try:
            result = process(info.photo, workdir / f"artist-{artist.id}")
        except ImageError:
            result = None
        if result is not None:
            key = f"images/artist/{hashlib.sha256(info.photo).hexdigest()[:12]}"
            upload_dir(ctx.storage, ctx.settings.s3_public_bucket, key, workdir / f"artist-{artist.id}")
            artist.photo_key, artist.photo_blurhash = key, result.blurhash
            artist.palette = result.palette.to_dict()
            artist.photo_credit = info.photo_credit
    if info.bio and not artist.bio:
        artist.bio, artist.bio_source = info.bio, info.bio_source


def artists(ctx: JobContext, artist_ids: list[uuid.UUID]) -> None:
    with ctx.sessions.begin() as session:
        rows = session.scalars(
            select(Artist).where(Artist.id.in_(artist_ids), Artist.enriched_at.is_(None))
        ).all()
        for artist in rows:
            if artist.photo_key and artist.bio:
                artist.enriched_at = datetime.now(UTC)
                continue
            try:
                apply_artist_info(session, ctx, artist, ctx.workdir)
            except Exception:
                log.warning("artist_enrich_failed", artist_id=str(artist.id), exc_info=True)
