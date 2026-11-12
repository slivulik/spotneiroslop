"""Internet Archive (https://archive.org): public-domain and Creative Commons audio, no key needed.

Search goes through `advancedsearch.php` (items), then `/metadata/{identifier}` lists each item's
files. One audio recording = one track: an original file plus the derivatives the Archive made from
it ("VBR MP3", "Ogg Vorbis" …) form a group, and the best file the pipeline accepts is chosen —
FLAC first, otherwise the highest-bitrate MP3. External id: `identifier/filename`.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from sonora_api.core.logging import get_logger
from sonora_api.services.sources.base import (
    MAX_EXTERNAL_ID,
    SourceKey,
    SourceTrack,
    SourceUnavailableError,
    http_client,
)
from sonora_api.services.sources.licenses import License, first_license

SEARCH = "https://archive.org/advancedsearch.php"
METADATA = "https://archive.org/metadata/{identifier}"
DOWNLOAD = "https://archive.org/download/{identifier}/{filename}"
DETAILS = "https://archive.org/details/{identifier}"
THUMBNAIL = "https://archive.org/services/img/{identifier}"

#: Items asked for per search (each costs one metadata request); tracks are cut to `limit` after.
MAX_ITEMS = 12
#: Metadata requests in flight at once (be polite to the Archive).
CONCURRENCY = 6
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
#: Lucene syntax characters: the admin's query is searched as plain words.
_LUCENE_SPECIAL = re.compile(r'([+\-!(){}\[\]^"~*?:\\/&|])')
_KBPS = re.compile(r"(\d+)\s*kbps", re.IGNORECASE)
_TRACK_NO = re.compile(r"^\s*(\d+)")

log = get_logger("sonora.sources.internet_archive")


def escape_query(query: str) -> str:
    return _LUCENE_SPECIAL.sub(r"\\\1", query.strip())


def _text(value: object) -> str | None:
    if isinstance(value, list):
        names = [v.strip() for v in value if isinstance(v, str) and v.strip()]
        return ", ".join(dict.fromkeys(names)) or None
    return value.strip() if isinstance(value, str) and value.strip() else None


def parse_length(value: object) -> int | None:
    """File `length`: seconds ("351.4") or a clock ("05:51", "1:02:03")."""
    text = _text(value)
    if not text:
        return None
    try:
        if ":" in text:
            seconds = 0.0
            for part in text.split(":"):
                seconds = seconds * 60 + float(part)
        else:
            seconds = float(text)
    except ValueError:
        return None
    return round(seconds) if seconds > 0 else None


def _kind(file: dict[str, Any]) -> str | None:
    """ "flac" / "mp3" when the media pipeline can take this file, else None."""
    name = str(file.get("name", "")).lower()
    fmt = str(file.get("format", "")).lower()
    if name.endswith(".flac") and "flac" in fmt and "fingerprint" not in fmt:
        return "flac"
    if name.endswith(".mp3") and "mp3" in fmt and "sample" not in fmt and "m3u" not in fmt:
        return "mp3"
    return None


def _bitrate(file: dict[str, Any]) -> float:
    raw = file.get("bitrate")
    try:
        if raw is not None:
            return float(str(raw))
    except ValueError:
        pass
    fmt = str(file.get("format", ""))
    if match := _KBPS.search(fmt):
        return float(match.group(1))
    # "VBR MP3" derivatives are ~190 kbps; an original "MP3" upload is usually at least that good.
    return 200.0 if file.get("source") == "original" else 190.0


def _rank(file: dict[str, Any]) -> tuple[int, float, int]:
    return (1 if _kind(file) == "flac" else 0, _bitrate(file), 1 if file.get("source") == "original" else 0)


def _groups(files: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Files grouped by the original recording they were made from (derivatives can chain)."""
    by_name = {str(f["name"]): f for f in files if isinstance(f.get("name"), str)}
    groups: dict[str, list[dict[str, Any]]] = {}
    for name, file in by_name.items():
        root, seen = name, {name}
        current = file
        while current.get("source") == "derivative":
            parent = current.get("original")
            if not isinstance(parent, str) or parent in seen:
                break
            root = parent
            seen.add(parent)
            if parent not in by_name:
                break
            current = by_name[parent]
        groups.setdefault(root, []).append(file)
    return groups


def _track_number(value: object) -> int | None:
    text = _text(value)
    match = _TRACK_NO.match(text) if text else None
    return int(match.group(1)) if match and int(match.group(1)) > 0 else None


def _stem(name: str) -> str:
    base = name.rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[0] if "." in base else base


@dataclass(frozen=True, slots=True)
class _Recording:
    """What all files of one recording share; `track()` binds it to a concrete file."""

    identifier: str
    title: str
    artist: str
    album: str | None
    duration_s: int | None
    license: License
    preview: str
    release_date: str | None
    track_number: int | None

    def _download(self, filename: str) -> str:
        return DOWNLOAD.format(identifier=self.identifier, filename=quote(filename, safe="/"))

    def track(self, filename: str, kind: str) -> SourceTrack:
        return SourceTrack(
            source="internet_archive",
            external_id=f"{self.identifier}/{filename}",
            title=self.title,
            artist=self.artist,
            album=self.album,
            duration_s=self.duration_s,
            license=self.license,
            artwork_url=THUMBNAIL.format(identifier=self.identifier),
            preview_url=self._download(self.preview),
            page_url=DETAILS.format(identifier=self.identifier),
            format=kind,
            download_url=self._download(filename),
            release_date=self.release_date,
            track_number=self.track_number,
        )


def _described(key: str, origin: dict[str, Any], group: list[dict[str, Any]]) -> str | None:
    """A per-file field (title, artist, album, track) from the original, else any derivative."""
    return _text(origin.get(key)) or next((v for f in group if (v := _text(f.get(key)))), None)


def _preview(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """Lightest stream for listening in the admin: the Archive's VBR MP3 if there is one."""
    mp3s = [f for f in candidates if _kind(f) == "mp3"]
    vbr = [f for f in mp3s if "vbr" in str(f.get("format", "")).lower()]
    return vbr[0] if vbr else min(mp3s, key=_bitrate) if mp3s else candidates[0]


def item_tracks(identifier: str, meta: dict[str, Any]) -> tuple[list[SourceTrack], dict[str, SourceTrack]]:
    """(best file of every recording in listing order, every importable file by external id)."""
    metadata = meta.get("metadata")
    files = meta.get("files")
    if not isinstance(metadata, dict) or not isinstance(files, list) or meta.get("is_dark"):
        return [], {}
    if str(metadata.get("access-restricted-item", "")).lower() == "true":  # lending-library items
        return [], {}
    license_ = first_license(metadata.get("licenseurl"))
    if license_ is None:
        return [], {}

    best: list[tuple[tuple[int, str], SourceTrack]] = []
    every: dict[str, SourceTrack] = {}
    for root, group in _groups([f for f in files if isinstance(f, dict)]).items():
        candidates = sorted((f for f in group if _kind(f)), key=_rank, reverse=True)
        if not candidates:
            continue
        origin = next((f for f in group if f.get("name") == root), candidates[0])
        artist = (
            _described("artist", origin, group)
            or _described("creator", origin, group)
            or _text(metadata.get("creator"))
        )
        if not artist:  # nobody to credit: CC BY can't be honoured, and the catalogue needs an artist
            continue
        recording = _Recording(
            identifier=identifier,
            title=_described("title", origin, group) or _stem(root),
            artist=artist,
            album=_described("album", origin, group) or _text(metadata.get("title")),
            duration_s=parse_length(origin.get("length"))
            or next((d for f in candidates if (d := parse_length(f.get("length")))), None),
            license=license_,
            preview=str(_preview(candidates)["name"]),
            release_date=_text(metadata.get("date")),
            track_number=_track_number(_described("track", origin, group)),
        )
        tracks = [
            recording.track(str(f["name"]), _kind(f) or "mp3")
            for f in candidates
            if len(f"{identifier}/{f['name']}") <= MAX_EXTERNAL_ID
        ]
        every.update({t.external_id: t for t in tracks})
        if tracks:
            best.append(((recording.track_number or 10_000, root.lower()), tracks[0]))
    best.sort(key=lambda pair: pair[0])
    return [track for _, track in best], every


class InternetArchiveSource:
    key: SourceKey = "internet_archive"
    title = "Internet Archive"
    description = "Архив общественного достояния и Creative Commons: концерты, старые записи, нетлейблы."

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.transport = transport

    def disabled_reason(self) -> str | None:
        return None

    async def _metadata(self, http: httpx.AsyncClient, identifier: str) -> dict[str, Any] | None:
        response = await http.get(METADATA.format(identifier=identifier))
        if response.status_code != 200:
            return None
        body = response.json()
        return body if isinstance(body, dict) and body else None

    async def _metadata_many(self, identifiers: Sequence[str]) -> dict[str, dict[str, Any] | None]:
        limit = asyncio.Semaphore(CONCURRENCY)

        async def one(http: httpx.AsyncClient, identifier: str) -> dict[str, Any] | None:
            async with limit:
                try:
                    return await self._metadata(http, identifier)
                except (httpx.HTTPError, ValueError) as exc:
                    log.warning("archive_metadata_failed", identifier=identifier, error=str(exc))
                    return None

        async with http_client(self.transport) as http:
            results = await asyncio.gather(*(one(http, i) for i in identifiers))
        return dict(zip(identifiers, results, strict=True))

    async def search(self, query: str, limit: int) -> list[SourceTrack]:
        q = f"({escape_query(query)}) AND mediatype:(audio) AND licenseurl:(*creativecommons.org*)"
        params: list[tuple[str, str | int | float | bool | None]] = [
            ("q", q),
            ("fl[]", "identifier"),
            ("fl[]", "licenseurl"),
            ("rows", str(min(limit, MAX_ITEMS))),
            ("page", "1"),
            ("output", "json"),
        ]
        try:
            async with http_client(self.transport) as http:
                response = await http.get(SEARCH, params=params)
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("archive_unreachable", error=str(exc))
            raise SourceUnavailableError("Internet Archive не отвечает — попробуйте позже") from exc
        result = body.get("response") if isinstance(body, dict) else None
        docs = result.get("docs") if isinstance(result, dict) else None
        if response.status_code != 200 or not isinstance(docs, list):
            raise SourceUnavailableError(f"Internet Archive ответил ошибкой (HTTP {response.status_code})")
        identifiers = [
            ident
            for doc in docs
            if isinstance(doc, dict)
            and isinstance(ident := doc.get("identifier"), str)
            and _IDENTIFIER.match(ident)
            and first_license(doc.get("licenseurl")) is not None
        ]
        if not identifiers:
            return []
        metadata = await self._metadata_many(identifiers)
        if all(m is None for m in metadata.values()):
            raise SourceUnavailableError("Internet Archive не отдал описание найденных записей")
        tracks: list[SourceTrack] = []
        for identifier in identifiers:
            meta = metadata[identifier]
            if meta is not None:
                tracks += item_tracks(identifier, meta)[0]
            if len(tracks) >= limit:
                break
        return tracks[:limit]

    async def resolve(self, external_ids: Sequence[str]) -> dict[str, SourceTrack]:
        wanted: dict[str, list[str]] = {}
        for external_id in dict.fromkeys(external_ids):
            identifier, _, filename = external_id.partition("/")
            if _IDENTIFIER.match(identifier) and filename:
                wanted.setdefault(identifier, []).append(external_id)
        if not wanted:
            return {}
        metadata = await self._metadata_many(list(wanted))
        if all(m is None for m in metadata.values()):
            raise SourceUnavailableError("Internet Archive не отвечает — попробуйте позже")
        found: dict[str, SourceTrack] = {}
        for identifier, ids in wanted.items():
            meta = metadata[identifier]
            if meta is None:
                continue
            every = item_tracks(identifier, meta)[1]
            found.update({i: every[i] for i in ids if i in every})
        return found
