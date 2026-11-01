"""LRCLIB (https://lrclib.net): free, open database of synced (LRC) and plain lyrics."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from sonora_api.enrich.common import client, same

BASE = "https://lrclib.net/api"
DURATION_TOLERANCE_S = 2.0


@dataclass(frozen=True)
class LyricsMatch:
    synced: str | None
    plain: str | None
    instrumental: bool
    source_id: int | None
    source: str = "lrclib"


def _fits(item: dict[str, object], artist: str, title: str, duration_s: float) -> bool:
    dur = item.get("duration")
    return (
        same(str(item.get("artistName", "")), artist)
        and same(str(item.get("trackName", "")), title)
        and isinstance(dur, int | float)
        and abs(float(dur) - duration_s) <= DURATION_TOLERANCE_S
    )


def _match(item: dict[str, object]) -> LyricsMatch:
    synced = item.get("syncedLyrics")
    plain = item.get("plainLyrics")
    source_id = item.get("id")
    return LyricsMatch(
        synced=synced if isinstance(synced, str) and synced.strip() else None,
        plain=plain if isinstance(plain, str) and plain.strip() else None,
        instrumental=bool(item.get("instrumental")),
        source_id=source_id if isinstance(source_id, int) else None,
    )


def find(
    artist: str,
    title: str,
    album: str | None,
    duration_s: float,
    *,
    transport: httpx.BaseTransport | None = None,
) -> LyricsMatch | None:
    """Exact signature lookup first (artist, title, album, duration), then a checked search."""
    try:
        with client(transport) as http:
            params = {"artist_name": artist, "track_name": title, "duration": str(round(duration_s))}
            if album:
                params["album_name"] = album
            r = http.get(f"{BASE}/get", params=params)
            if r.status_code == 200 and _fits(r.json(), artist, title, duration_s):
                return _match(r.json())
            r = http.get(f"{BASE}/search", params={"artist_name": artist, "track_name": title})
            if r.status_code != 200:
                return None
            hits = [h for h in r.json() if isinstance(h, dict) and _fits(h, artist, title, duration_s)]
            # Prefer synced lyrics, then the closest duration.
            hits.sort(key=lambda h: (not h.get("syncedLyrics"), abs(float(h["duration"]) - duration_s)))
            return _match(hits[0]) if hits else None
    except (httpx.HTTPError, ValueError):
        return None
