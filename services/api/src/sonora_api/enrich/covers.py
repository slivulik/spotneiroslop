"""One entry point for covers: exact MusicBrainz identification first, then Deezer by title."""

from __future__ import annotations

from dataclasses import dataclass

from sonora_api.enrich import deezer, musicbrainz


@dataclass(frozen=True)
class CoverMatch:
    data: bytes
    source: str


def find(
    artist: str, album: str, *, track_count: int | None = None, single_title: str | None = None
) -> CoverMatch | None:
    """`single_title` is the track title of a one-track release (searched as a track too)."""
    mbid = musicbrainz.find_release_mbid(artist, album, track_count)
    if mbid:
        data = musicbrainz.front_cover(mbid)
        if data:
            return CoverMatch(data, f"https://musicbrainz.org/release/{mbid}")
    found = deezer.find_cover(artist, album, track_title=single_title)
    if found:
        return CoverMatch(*found)
    return None
