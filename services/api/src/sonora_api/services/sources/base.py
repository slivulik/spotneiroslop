"""Shared pieces of the open-catalogue sources: the `Source` protocol, the normalised track,
upstream errors, the download allow-list and the job options the media worker reads."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict

from sonora_api.core.errors import AppError
from sonora_api.enrich.common import USER_AGENT
from sonora_api.services.sources.licenses import License

SourceKey = Literal["jamendo", "internet_archive"]

#: Readable names, also shown in the licence note under imported tracks.
SOURCE_TITLES: dict[str, str] = {"jamendo": "Jamendo", "internet_archive": "Internet Archive"}

#: Audio and artwork are only ever downloaded from these sites (and their subdomains), over HTTPS.
ALLOWED_DOWNLOAD_DOMAINS = ("jamendo.com", "archive.org")

#: Longest external id we store (`tracks.source_external_id`).
MAX_EXTERNAL_ID = 512

TIMEOUT = httpx.Timeout(12.0, connect=5.0)


def is_allowed_url(url: str) -> bool:
    """True for https URLs on an allow-listed host (no credentials, default port)."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError:
        return False
    if parts.scheme != "https" or parts.username or parts.password or port not in {None, 443}:
        return False
    return any(host == d or host.endswith(f".{d}") for d in ALLOWED_DOWNLOAD_DOMAINS)


def http_client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=TIMEOUT,
        follow_redirects=True,
        transport=transport,
    )


class SourceUnavailableError(AppError):
    """The catalogue did not answer or answered nonsense: a gateway problem, never a 500."""

    status_code = 502
    code = "source_unavailable"


class SourceDisabledError(AppError):
    status_code = 409
    code = "source_disabled"


@dataclass(frozen=True, slots=True)
class SourceTrack:
    """One importable recording, normalised across catalogues."""

    source: SourceKey
    external_id: str
    title: str
    artist: str
    album: str | None
    duration_s: int | None
    license: License
    artwork_url: str | None
    preview_url: str | None
    page_url: str
    #: Container of `download_url`: "flac" or "mp3" (what the media pipeline accepts).
    format: str
    download_url: str
    #: Tried when `download_url` fails (e.g. Jamendo has no FLAC for this track): an MP3.
    fallback_url: str | None = None
    release_date: str | None = None
    track_number: int | None = None


class Source(Protocol):
    key: SourceKey
    title: str
    description: str

    def disabled_reason(self) -> str | None:
        """Why the source can't be used right now (in Russian, shown in the admin), or None."""
        ...

    async def search(self, query: str, limit: int) -> list[SourceTrack]:
        """Free-licence tracks matching `query`, best matches first, at most `limit`."""
        ...

    async def resolve(self, external_ids: Sequence[str]) -> dict[str, SourceTrack]:
        """Look the ids up again at the source; unknown or no-longer-free ids are left out."""
        ...


# ---------------------------------------------------------------------------
# Upload-job options of an import (contract with the media worker)
# ---------------------------------------------------------------------------


class ImportLicense(BaseModel):
    code: str
    url: str | None = None


class ImportMeta(BaseModel):
    """What the catalogue says about the recording: used when the file itself lacks tags."""

    title: str
    artist: str
    album: str | None = None
    duration_s: int | None = None
    artwork_url: str | None = None
    release_date: str | None = None
    track_number: int | None = None


class ImportJobOptions(BaseModel):
    """`upload_jobs.options` of an imported track. The API writes it after re-resolving the id at
    the source; the media worker downloads `download_url` (allow-listed hosts only) and copies the
    licence onto the track."""

    model_config = ConfigDict(extra="ignore")

    publish: bool = False
    allow_duplicate: bool = False
    source: SourceKey
    external_id: str
    download_url: str
    fallback_url: str | None = None
    format: str
    license: ImportLicense
    attribution: str | None = None
    page_url: str
    source_meta: ImportMeta

    @classmethod
    def for_track(cls, track: SourceTrack, *, publish: bool) -> ImportJobOptions:
        return cls(
            publish=publish,
            source=track.source,
            external_id=track.external_id,
            download_url=track.download_url,
            fallback_url=track.fallback_url,
            format=track.format,
            license=ImportLicense(code=track.license.code, url=track.license.url),
            attribution=track.artist,
            page_url=track.page_url,
            source_meta=ImportMeta(
                title=track.title,
                artist=track.artist,
                album=track.album,
                duration_s=track.duration_s,
                artwork_url=track.artwork_url,
                release_date=track.release_date,
                track_number=track.track_number,
            ),
        )
