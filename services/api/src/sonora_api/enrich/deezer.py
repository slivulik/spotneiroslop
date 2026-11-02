"""Deezer public search (no key) as a second cover source: wide coverage of Russian releases.

Matching is as strict as for MusicBrainz: the credited artist and the title must be equal after
normalisation. Albums are searched by album title; singles also by track title.
"""

from __future__ import annotations

from typing import Any

import httpx

from sonora_api.enrich.common import RateLimit, client, same

API = "https://api.deezer.com"
_limit = RateLimit(0.25)  # Deezer allows 50 requests / 5 s; stay well below


def _q(value: str) -> str:
    return '"' + value.replace('"', " ") + '"'


def _get(http: httpx.Client, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    _limit.wait()
    r = http.get(f"{API}{path}", params=params)
    if r.status_code != 200:
        return []
    body = r.json()
    if not isinstance(body, dict) or "error" in body:
        return []
    data = body.get("data")
    return [d for d in data if isinstance(d, dict)] if isinstance(data, list) else []


def _download(http: httpx.Client, url: str | None) -> bytes | None:
    if not url:
        return None
    r = http.get(url)
    if (
        r.status_code == 200
        and r.headers.get("content-type", "").startswith("image/")
        and len(r.content) > 2048
    ):
        return r.content
    return None


def find_cover(
    artist: str, title: str, *, track_title: str | None = None, transport: httpx.BaseTransport | None = None
) -> tuple[bytes, str] | None:
    """Front cover (up to 1000 px) of the album `title` by `artist`, or of the single `track_title`."""
    try:
        with client(transport) as http:
            for item in _get(
                http, "/search/album", {"q": f"artist:{_q(artist)} album:{_q(title)}", "limit": 10}
            ):
                name = (item.get("artist") or {}).get("name")
                if same(item.get("title"), title) and same(name, artist):
                    data = _download(http, item.get("cover_xl") or item.get("cover_big"))
                    if data:
                        return data, str(item.get("link") or f"https://www.deezer.com/album/{item.get('id')}")
            if track_title:
                for item in _get(
                    http, "/search/track", {"q": f"artist:{_q(artist)} track:{_q(track_title)}", "limit": 10}
                ):
                    album = item.get("album") or {}
                    name = (item.get("artist") or {}).get("name")
                    if same(item.get("title"), track_title) and same(name, artist):
                        data = _download(http, album.get("cover_xl") or album.get("cover_big"))
                        if data:
                            return data, str(item.get("link") or "https://www.deezer.com")
    except (httpx.HTTPError, ValueError):
        return None
    return None
