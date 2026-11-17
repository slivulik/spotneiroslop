"""Lyrics on demand: a track without lyrics gets one LRCLIB lookup when someone opens its lyrics.

Uploads and the catalogue backfill search LRCLIB already, but tracks processed while it was down,
or before someone published synced lyrics there, would otherwise wait for the next backfill. The
match is the same strict one (`enrich.lrclib`: names equal after normalisation, duration within
two seconds) and the result is stored as automatic lyrics, so text entered by a person always
wins. A miss is remembered for a week, so a popular track without lyrics doesn't send LRCLIB a
request on every play; a failed request (network, LRCLIB down) is not remembered at all.
"""

from __future__ import annotations

import asyncio
import urllib.request
from datetime import timedelta
from typing import Any

import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.logging import get_logger
from sonora_api.enrich import lrclib
from sonora_api.media.lyrics import line_document, parse_lrc, static_document
from sonora_api.models import Artist, Lyrics, Release, Track, TrackArtist
from sonora_api.models.enums import LyricsSource, LyricsType
from sonora_api.services import platform

log = get_logger("sonora.lyrics")

LRCLIB_HOST = "lrclib.net"
MISS_TTL = timedelta(days=7)
#: One lookup per track at a time; concurrent requests answer «no lyrics» meanwhile.
LOOKUP_LOCK_TTL = timedelta(seconds=30)


def miss_key(track_id: object) -> str:
    return f"lyrics:miss:{track_id}"


def _lock_key(track_id: object) -> str:
    return f"lyrics:lookup:{track_id}"


async def remember_miss(redis: Redis, track_id: object, ttl: timedelta | None = MISS_TTL) -> None:
    """Don't look this track up (for `ttl`, or until Redis forgets when None): after a miss, or
    when an admin removed wrong automatic lyrics and the same ones must not come back."""
    await redis.set(miss_key(track_id), "1", ex=ttl)


class _Watched(httpx.BaseTransport):
    """Passes requests through and notes whether LRCLIB could actually be asked.

    `lrclib.find` answers None both for «no such lyrics» and for a failed request; only the
    first may be cached as a miss, so the transport underneath tells them apart.
    """

    def __init__(self, inner: httpx.BaseTransport) -> None:
        self._inner = inner
        self.failed = False

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        try:
            response = self._inner.handle_request(request)
        except httpx.TransportError:
            self.failed = True
            raise
        if response.status_code == httpx.codes.TOO_MANY_REQUESTS or response.status_code >= 500:
            self.failed = True
        return response

    def close(self) -> None:
        self._inner.close()


def _lrclib_transport() -> httpx.BaseTransport:
    """The real network, through the environment's HTTPS proxy when one is set (httpx ignores
    HTTPS_PROXY once a transport is passed explicitly). Tests substitute an `httpx.MockTransport`."""
    proxy: str | None = urllib.request.getproxies().get("https")
    if proxy and urllib.request.proxy_bypass(LRCLIB_HOST):
        proxy = None
    return httpx.HTTPTransport(proxy=proxy)


def _document(match: lrclib.LyricsMatch, duration_ms: int) -> tuple[LyricsType, dict[str, Any]] | None:
    """Synced lyrics when LRCLIB has them, else plain text; nothing for instrumentals."""
    if match.instrumental:
        return None
    lines = parse_lrc(match.synced) if match.synced else []
    if lines:
        return LyricsType.LINE, line_document(lines, duration_ms)
    if match.plain:
        return LyricsType.STATIC, static_document(match.plain)
    return None


async def find_missing(session: AsyncSession, redis: Redis, track: Track) -> Lyrics | None:
    """Look LRCLIB up once for a track that has no lyrics; store and return what was found.

    Answers None (the caller's «no lyrics») when enrichment is switched off in the admin panel,
    after a remembered miss, while another request is already looking, and on any failure.
    """
    if await redis.exists(miss_key(track.id)):
        return None
    if not (await platform.get_config(session)).metadata_lookup:
        return None
    lock = _lock_key(track.id)
    if not await redis.set(lock, "1", nx=True, ex=LOOKUP_LOCK_TTL):
        return None
    try:
        return await _lookup(session, redis, track)
    finally:
        await redis.delete(lock)


async def _lookup(session: AsyncSession, redis: Redis, track: Track) -> Lyrics | None:
    artist = await session.scalar(
        select(Artist.name)
        .join(TrackArtist, TrackArtist.artist_id == Artist.id)
        .where(TrackArtist.track_id == track.id)
        .order_by(TrackArtist.position)
        .limit(1)
    )
    if not artist:
        return None
    album = await session.scalar(select(Release.title).where(Release.id == track.release_id))
    await session.commit()  # nothing to write yet: don't hold a pooled connection during the request
    answered, document = await _ask_lrclib(artist, track.title, album, track.duration_ms)
    if document is None:
        if answered:  # a real «not there»; a failed request is simply retried next time
            await remember_miss(redis, track.id)
        return None
    return await _store(session, track, *document)


async def _ask_lrclib(
    artist: str, title: str, album: str | None, duration_ms: int
) -> tuple[bool, tuple[LyricsType, dict[str, Any]] | None]:
    """(answered, document): `answered` is False when LRCLIB couldn't be asked at all."""
    try:
        watched = _Watched(_lrclib_transport())
        match = await asyncio.to_thread(
            lrclib.find, artist, title, album, duration_ms / 1000, transport=watched
        )
    except Exception:  # lrclib.find swallows HTTP errors; anything else must not break the page
        log.warning("lyrics_lookup_failed", artist=artist, title=title, exc_info=True)
        return False, None
    if watched.failed:
        return False, None
    return True, (_document(match, duration_ms) if match is not None else None)


async def _store(
    session: AsyncSession, track: Track, kind: LyricsType, body: dict[str, Any]
) -> Lyrics | None:
    track_id = track.id
    try:
        # A row may have appeared meanwhile (the worker, an admin): keep it, it is at least as good.
        await session.execute(
            insert(Lyrics)
            .values(track_id=track_id, type=kind, body=body, source=LyricsSource.AUTO)
            .on_conflict_do_nothing(index_elements=["track_id"])
        )
        row = await session.get(Lyrics, track_id, populate_existing=True)
        if row is not None:
            track.has_lyrics, track.lyrics_type = True, row.type
            await session.commit()
    except IntegrityError:  # the track was deleted while LRCLIB was being asked
        await session.rollback()
        return None
    return row
