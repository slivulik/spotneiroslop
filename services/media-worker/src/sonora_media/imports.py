"""Tracks imported from open catalogues (Jamendo, Internet Archive).

The API stores `ImportJobOptions` in the job's options after re-resolving the recording at the
source. Here they fill gaps in the file's tags and end up on the catalogue track as its licence,
origin and attribution.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError
from sonora_api.models import Track
from sonora_api.services.sources.base import SOURCE_TITLES, ImportJobOptions
from sqlalchemy import select
from sqlalchemy.orm import Session

from sonora_media.errors import MediaError
from sonora_media.tags import TrackTags, parse_date, split_artists, split_title


def spec(options: dict[str, Any]) -> ImportJobOptions | None:
    """Import details of a job, or None for an ordinary (browser / CLI) upload."""
    if "source" not in options:
        return None
    try:
        return ImportJobOptions.model_validate(options)
    except ValidationError as exc:
        raise MediaError(f"Повреждены параметры импорта: {exc.error_count()} ошибок") from exc


def title(job: ImportJobOptions) -> str:
    return SOURCE_TITLES.get(job.source, job.source)


def filename(job: ImportJobOptions, kind: str) -> str:
    """Readable name for the job's file list: «Artist — Title.flac»."""
    name = f"{job.source_meta.artist} — {job.source_meta.title}"
    safe = "".join("_" if ch in '/\\:*?"<>|' or ord(ch) < 32 else ch for ch in name).strip()
    return f"{safe[:200] or 'track'}.{kind}"


def fill_tags(tags: TrackTags, job: ImportJobOptions, warn: Callable[[str, str], None]) -> None:
    """Use the catalogue's description wherever the file has no tag of its own."""
    meta = job.source_meta
    filled: list[str] = []
    if not tags.title:
        tags.title, version, featured = split_title(meta.title)
        tags.version = tags.version or version
        tags.featured = list(dict.fromkeys([*tags.featured, *featured]))
        filled.append("название")
    if not tags.artists:
        tags.artists, featured = split_artists([meta.artist])
        tags.featured = [f for f in dict.fromkeys([*tags.featured, *featured]) if f not in tags.artists]
        filled.append("исполнитель")
    if not tags.album and meta.album:
        tags.album = meta.album
        filled.append("альбом")
    if not tags.track_number and meta.track_number and meta.album:
        tags.track_number = meta.track_number
    if not tags.release_date and meta.release_date:
        tags.release_date = parse_date(meta.release_date)
    if filled:
        warn(
            "tags_from_source", f"Нет тегов в файле ({', '.join(filled)}) — взяты из описания на {title(job)}"
        )


def already_imported(
    session: Session, job: ImportJobOptions, *, exclude: uuid.UUID | None
) -> uuid.UUID | None:
    """Id of another catalogue track made from the same recording."""
    query = select(Track.id).where(
        Track.source_name == job.source, Track.source_external_id == job.external_id
    )
    if exclude is not None:
        query = query.where(Track.id != exclude)
    return session.scalar(query)


def _clip(value: str | None, limit: int) -> str | None:
    return value[:limit] if value else None


def apply_to_track(track: Track, job: ImportJobOptions) -> None:
    """Licence, origin and attribution onto the catalogue track (column sizes: migration 0007)."""
    track.license_code = job.license.code[:64]
    track.license_url = _clip(job.license.url, 512)
    track.source_name = job.source
    track.source_external_id = job.external_id
    track.source_url = _clip(job.page_url, 512)
    track.attribution = _clip(job.attribution, 512)
