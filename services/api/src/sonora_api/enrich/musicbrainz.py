"""MusicBrainz identification + Cover Art Archive front covers (both open, no key)."""

from __future__ import annotations

import httpx

from sonora_api.enrich.common import RateLimit, client, same

MB = "https://musicbrainz.org/ws/2"
CAA = "https://coverartarchive.org"
_limit = RateLimit(1.1)
MIN_SCORE = 95


def _q(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def find_release_mbid(
    artist: str, album: str, track_count: int | None, *, transport: httpx.BaseTransport | None = None
) -> str | None:
    """A release whose title and credited artist match exactly; track count breaks ties."""
    try:
        with client(transport) as http:
            _limit.wait()
            r = http.get(
                f"{MB}/release",
                params={
                    "query": f"release:{_q(album)} AND artist:{_q(artist)}",
                    "fmt": "json",
                    "limit": "10",
                },
            )
            if r.status_code != 200:
                return None
            ok = []
            for rel in r.json().get("releases", []):
                credit = "".join(
                    c.get("name", "") + c.get("joinphrase", "") for c in rel.get("artist-credit", [])
                )
                if (
                    int(rel.get("score", 0)) >= MIN_SCORE
                    and same(rel.get("title"), album)
                    and same(credit, artist)
                ):
                    ok.append(rel)
            if track_count:
                exact = [x for x in ok if x.get("track-count") == track_count]
                ok = exact or ok
            return ok[0]["id"] if ok else None
    except (httpx.HTTPError, ValueError, KeyError):
        return None


def front_cover(mbid: str, *, transport: httpx.BaseTransport | None = None) -> bytes | None:
    """The release's approved front image at 1200 px (falls back to the original)."""
    try:
        with client(transport) as http:
            for path in (f"{CAA}/release/{mbid}/front-1200", f"{CAA}/release/{mbid}/front"):
                r = http.get(path)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
                    return r.content
    except httpx.HTTPError:
        return None
    return None


def find_artist_wikidata(name: str, *, transport: httpx.BaseTransport | None = None) -> str | None:
    """Wikidata id of an unambiguous MusicBrainz artist with exactly this name."""
    try:
        with client(transport) as http:
            _limit.wait()
            r = http.get(f"{MB}/artist", params={"query": f"artist:{_q(name)}", "fmt": "json", "limit": "5"})
            if r.status_code != 200:
                return None
            exact = [
                a
                for a in r.json().get("artists", [])
                if int(a.get("score", 0)) >= MIN_SCORE and same(a.get("name"), name)
            ]
            if len(exact) != 1:  # namesakes: refuse rather than guess
                return None
            _limit.wait()
            r = http.get(f"{MB}/artist/{exact[0]['id']}", params={"inc": "url-rels", "fmt": "json"})
            if r.status_code != 200:
                return None
            for rel in r.json().get("relations", []):
                url = rel.get("url", {}).get("resource", "")
                if rel.get("type") == "wikidata" and "/wiki/Q" in url:
                    return str(url.rsplit("/", 1)[-1])
            return None
    except (httpx.HTTPError, ValueError, KeyError):
        return None
