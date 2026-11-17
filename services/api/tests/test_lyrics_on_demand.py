"""Lyrics on demand: one LRCLIB lookup for a track without lyrics (HTTP is a mock transport)."""

from collections.abc import Callable

import httpx
import pytest

from sonora_api.models import Lyrics, PlatformSetting, Track
from sonora_api.models.enums import LyricsSource, LyricsType
from sonora_api.services import lyrics_on_demand
from tests.conftest import Catalog, Harness, bearer, register

Handler = Callable[[httpx.Request], httpx.Response]


def fake_lrclib(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> list[str]:
    """Route the lookups to `handler`; returns the list of requested paths, filled as they come."""
    calls: list[str] = []

    def recording(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return handler(request)

    monkeypatch.setattr(lyrics_on_demand, "_lrclib_transport", lambda: httpx.MockTransport(recording))
    return calls


def _not_found(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/search":
        return httpx.Response(200, json=[])
    return httpx.Response(404)


async def test_missing_lyrics_are_found_stored_and_served(
    harness: Harness, catalog_data: Catalog, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = catalog_data.tracks[0]  # «Tides #1» by Night Shore, 3:00
    hit = {
        "id": 11,
        "artistName": "Night Shore",
        "trackName": "Tides #1",
        "duration": 180.0,
        "syncedLyrics": "[00:01.00]Первая\n[00:04.50]Вторая",
        "plainLyrics": "Первая\nВторая",
        "instrumental": False,
    }
    calls = fake_lrclib(
        monkeypatch,
        lambda r: httpx.Response(200, json=hit) if r.url.path == "/api/get" else httpx.Response(404),
    )
    me = bearer(await register(harness.client))
    url = f"/v1/tracks/{track.id}/lyrics"

    first = await harness.client.get(url, headers=me)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["type"] == "line"
    assert [line["start_ms"] for line in body["lines"]] == [1000, 4500]
    assert [line["text"] for line in body["lines"]] == ["Первая", "Вторая"]
    assert body["lines"][-1]["end_ms"] == track.duration_ms
    assert calls == ["/api/get"]

    again = await harness.client.get(url, headers=me)
    assert again.json() == body
    assert calls == ["/api/get"]  # stored: no second lookup
    async with harness.ctx.sessionmaker() as s:
        row = await s.get(Lyrics, track.id)
        assert row is not None
        assert (row.type, row.source) == (LyricsType.LINE, LyricsSource.AUTO)
        stored = await s.get(Track, track.id)
        assert stored is not None
        assert (stored.has_lyrics, stored.lyrics_type) == (True, LyricsType.LINE)


async def test_a_miss_is_remembered(
    harness: Harness, catalog_data: Catalog, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = catalog_data.tracks[1]
    calls = fake_lrclib(monkeypatch, _not_found)
    me = bearer(await register(harness.client))
    url = f"/v1/tracks/{track.id}/lyrics"

    assert (await harness.client.get(url, headers=me)).status_code == 204
    assert calls == ["/api/get", "/api/search"]
    assert (await harness.client.get(url, headers=me)).status_code == 204
    assert len(calls) == 2  # cached miss: LRCLIB isn't asked again
    ttl = await harness.ctx.redis.ttl(lyrics_on_demand.miss_key(track.id))
    assert 6 * 86_400 < ttl <= 7 * 86_400


async def test_failed_requests_are_not_remembered(
    harness: Harness, catalog_data: Catalog, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = catalog_data.tracks[2]
    me = bearer(await register(harness.client))
    url = f"/v1/tracks/{track.id}/lyrics"

    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    calls = fake_lrclib(monkeypatch, offline)
    assert (await harness.client.get(url, headers=me)).status_code == 204
    assert (await harness.client.get(url, headers=me)).status_code == 204
    assert len(calls) == 2  # asked again: a network error is not a miss

    down = fake_lrclib(monkeypatch, lambda r: httpx.Response(503))
    assert (await harness.client.get(url, headers=me)).status_code == 204
    assert down == ["/api/get", "/api/search"]
    assert not await harness.ctx.redis.exists(lyrics_on_demand.miss_key(track.id))


async def test_no_lookup_when_enrichment_is_off(
    harness: Harness, catalog_data: Catalog, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with harness.ctx.sessionmaker() as s:
        s.add(PlatformSetting(key="config", value={"metadata_lookup": False}))
        await s.commit()
    calls = fake_lrclib(monkeypatch, _not_found)
    me = bearer(await register(harness.client))
    track = catalog_data.tracks[0]

    assert (await harness.client.get(f"/v1/tracks/{track.id}/lyrics", headers=me)).status_code == 204
    assert calls == []
    assert not await harness.ctx.redis.exists(lyrics_on_demand.miss_key(track.id))
