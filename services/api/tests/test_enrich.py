"""Matching rules of the open-database clients (isolated: HTTP is a mock transport)."""

import json

import httpx

from sonora_api.enrich import lrclib, musicbrainz, wikimedia
from sonora_api.enrich.common import normalize, same


def transport(routes: dict[str, httpx.Response]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        for prefix, response in routes.items():
            if str(request.url).startswith(prefix):
                return response
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def test_normalize_ignores_case_accents_and_feat() -> None:
    assert normalize("Ёлка (feat. Баста)") == normalize("елка")
    assert same("Beyoncé", "Beyonce")
    assert same("Song (Remastered 2011)", "song")
    assert not same("", "")


def test_lrclib_exact_signature_match() -> None:
    hit = {
        "id": 7,
        "artistName": "Мираж",
        "trackName": "Песок",
        "duration": 35.0,
        "syncedLyrics": "[00:01.00]А",
        "plainLyrics": "А",
        "instrumental": False,
    }
    t = transport({"https://lrclib.net/api/get": httpx.Response(200, json=hit)})
    m = lrclib.find("Мираж", "Песок", "Закат", 35.4, transport=t)
    assert m is not None
    assert m.synced == "[00:01.00]А"
    assert m.source_id == 7


def test_lrclib_rejects_wrong_duration_and_other_artists() -> None:
    wrong = [
        {"id": 1, "artistName": "Мираж", "trackName": "Песок", "duration": 41.0, "syncedLyrics": "x"},
        {"id": 2, "artistName": "Другой", "trackName": "Песок", "duration": 35.0, "syncedLyrics": "y"},
    ]
    t = transport(
        {
            "https://lrclib.net/api/get": httpx.Response(404),
            "https://lrclib.net/api/search": httpx.Response(200, json=wrong),
        }
    )
    assert lrclib.find("Мираж", "Песок", None, 35.0, transport=t) is None


def test_lrclib_search_prefers_synced_then_closest() -> None:
    hits = [
        {"id": 1, "artistName": "Мираж", "trackName": "Песок", "duration": 35.0, "plainLyrics": "plain only"},
        {
            "id": 2,
            "artistName": "Мираж",
            "trackName": "Песок",
            "duration": 36.5,
            "syncedLyrics": "[00:01.00]s",
        },
    ]
    t = transport(
        {
            "https://lrclib.net/api/get": httpx.Response(404),
            "https://lrclib.net/api/search": httpx.Response(200, json=hits),
        }
    )
    m = lrclib.find("Мираж", "Песок", None, 35.0, transport=t)
    assert m is not None
    assert m.source_id == 2


def test_musicbrainz_release_requires_exact_title_artist_and_prefers_track_count() -> None:
    credit = [{"name": "Мираж"}]
    body = {
        "releases": [
            {"id": "a", "score": 100, "title": "Закат", "track-count": 9, "artist-credit": credit},
            {"id": "b", "score": 100, "title": "Закат", "track-count": 2, "artist-credit": credit},
            {"id": "c", "score": 100, "title": "Закат (Live)", "track-count": 2, "artist-credit": credit},
        ]
    }
    t = transport({"https://musicbrainz.org/ws/2/release": httpx.Response(200, json=body)})
    musicbrainz._limit.interval = 0
    assert musicbrainz.find_release_mbid("Мираж", "Закат", 2, transport=t) == "b"
    assert musicbrainz.find_release_mbid("Другой", "Закат", 2, transport=t) is None


def test_musicbrainz_artist_refuses_namesakes() -> None:
    musicbrainz._limit.interval = 0
    two = {
        "artists": [
            {"id": "1", "score": 100, "name": "Nirvana"},
            {"id": "2", "score": 100, "name": "Nirvana"},
        ]
    }
    t = transport({"https://musicbrainz.org/ws/2/artist": httpx.Response(200, json=two)})
    assert musicbrainz.find_artist_wikidata("Nirvana", transport=t) is None
    one = {"artists": [{"id": "x1", "score": 100, "name": "Мираж"}]}
    rels = {"relations": [{"type": "wikidata", "url": {"resource": "https://www.wikidata.org/wiki/Q42"}}]}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=rels if "/artist/x1" in str(request.url) else one)

    assert musicbrainz.find_artist_wikidata("Мираж", transport=httpx.MockTransport(handler)) == "Q42"


def test_wikimedia_photo_with_credit_and_russian_summary() -> None:
    entity = {
        "entities": {
            "Q42": {
                "claims": {"P18": [{"mainsnak": {"datavalue": {"value": "Band photo.jpg"}}}]},
                "sitelinks": {"ruwiki": {"title": "Мираж (группа)"}},
            }
        }
    }
    summary = {
        "extract": "Советская поп-группа.",
        "content_urls": {"desktop": {"page": "https://ru.wikipedia.org/wiki/x"}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "EntityData" in url:
            return httpx.Response(200, content=json.dumps(entity))
        if "Special:FilePath" in url:
            return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})
        if "ru.wikipedia.org" in url:
            return httpx.Response(200, json=summary)
        return httpx.Response(404)

    info = wikimedia.artist_info("Q42", transport=httpx.MockTransport(handler))
    assert info is not None
    assert info.photo == b"\xff\xd8jpeg"
    assert info.photo_credit == "https://commons.wikimedia.org/wiki/File:Band_photo.jpg"
    assert info.bio == "Советская поп-группа."
    assert info.bio_source == "https://ru.wikipedia.org/wiki/x"


def test_network_failure_is_quietly_none() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    t = httpx.MockTransport(boom)
    assert lrclib.find("a", "b", None, 1, transport=t) is None
    assert musicbrainz.front_cover("x", transport=t) is None
    assert wikimedia.artist_info("Q1", transport=t) is None
