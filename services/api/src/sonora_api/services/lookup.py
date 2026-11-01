"""Manual metadata lookups for the admin panel (the worker does the same automatically on upload).

Each lookup returns a suggestion and changes nothing: the admin reviews it and applies it through
the regular edit endpoints. Found images are uploaded right away so the preview is a real
artwork the PATCH can reference.
"""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sonora_api.core.context import AppContext
from sonora_api.core.errors import NotFoundError
from sonora_api.enrich import lrclib, musicbrainz, wikimedia
from sonora_api.models.catalog import Artist, Release, ReleaseArtist, Track, TrackArtist
from sonora_api.models.enums import ImageKind
from sonora_api.schemas.admin_catalog import ArtistSuggestion, CoverSuggestion, LyricsSuggestion
from sonora_api.services.images import upload_image


class NothingFoundError(NotFoundError):
    code = "nothing_found"


async def track_lyrics(session: AsyncSession, track_id: uuid.UUID) -> LyricsSuggestion:
    track = await session.scalar(
        select(Track)
        .where(Track.id == track_id)
        .options(
            selectinload(Track.release),
            selectinload(Track.artist_links).selectinload(TrackArtist.artist),
        )
    )
    if track is None:
        raise NotFoundError("Track not found")
    links = sorted(track.artist_links, key=lambda link: link.position)
    if not links:
        raise NothingFoundError("Track has no artist to search by")
    match = await asyncio.to_thread(
        lrclib.find, links[0].artist.name, track.title, track.release.title, track.duration_ms / 1000
    )
    if match is None or not (match.synced or match.plain):
        raise NothingFoundError("LRCLIB has no lyrics for this track")
    source = f"https://lrclib.net/api/get/{match.source_id}" if match.source_id else "https://lrclib.net"
    if match.synced:
        return LyricsSuggestion(format="lrc", text=match.synced, source=source)
    return LyricsSuggestion(format="plain", text=match.plain or "", source=source)


async def release_cover(session: AsyncSession, ctx: AppContext, release_id: uuid.UUID) -> CoverSuggestion:
    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id)
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
    )
    if release is None:
        raise NotFoundError("Release not found")
    links = sorted(release.artist_links, key=lambda link: link.position)
    if not links:
        raise NothingFoundError("Release has no artist to search by")
    mbid = await asyncio.to_thread(
        musicbrainz.find_release_mbid, links[0].artist.name, release.title, release.track_count or None
    )
    data = await asyncio.to_thread(musicbrainz.front_cover, mbid) if mbid else None
    if not data:
        raise NothingFoundError("No matching release with a cover in MusicBrainz")
    image = await upload_image(ctx, ImageKind.RELEASE, data)
    return CoverSuggestion(image=image, source=f"https://musicbrainz.org/release/{mbid}")


async def artist_info(session: AsyncSession, ctx: AppContext, artist_id: uuid.UUID) -> ArtistSuggestion:
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise NotFoundError("Artist not found")
    qid = await asyncio.to_thread(musicbrainz.find_artist_wikidata, artist.name)
    info = await asyncio.to_thread(wikimedia.artist_info, qid) if qid else None
    if info is None or not (info.photo or info.bio):
        raise NothingFoundError("No unambiguous Wikidata entry with a photo or biography")
    image = await upload_image(ctx, ImageKind.ARTIST, info.photo) if info.photo else None
    return ArtistSuggestion(
        photo=image,
        photo_credit=info.photo_credit if image else None,
        bio=info.bio,
        bio_source=info.bio_source if info.bio else None,
    )
