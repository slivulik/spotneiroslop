"""Regressions found by the round 1 review (docs/team/review-01)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from sonora_api.models import ListeningHistory, Lyrics, Track
from sonora_api.models.enums import LyricsSource, LyricsType
from tests.conftest import Catalog, Harness, bearer, register
from tests.test_wave import _feedback, _ids, _next, _start


def _play(track: Track, ms: int, at: str | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {
        "event_id": str(uuid.uuid4()),
        "type": "play_end",
        "track_id": str(track.id),
        "ms_played": ms,
    }
    if at is not None:
        event["at"] = at
    return event


async def _post_events(harness: Harness, me: dict[str, str], events: list[dict[str, Any]]) -> dict[str, Any]:
    response = await harness.client.post("/v1/events/batch", headers=me, json={"events": events})
    assert response.status_code == 200, response.text
    out: dict[str, Any] = response.json()
    return out


async def _play_count(harness: Harness, track: Track) -> int:
    async with harness.ctx.sessionmaker() as s:
        row = await s.get(Track, track.id)
        assert row is not None
        return row.play_count


async def test_exhausted_wave_returns_full_batches_oldest_first(
    harness: Harness, catalog_data: Catalog
) -> None:
    me = bearer(await register(harness.client))
    started = await _start(harness, me, limit=50)
    sid = started["session_id"]
    served = _ids(started["tracks"])
    total = len(served)
    assert total == len(set(served)) >= 4

    # Nothing new is left: a batch is as full as the catalogue allows, and every track waits for
    # all the others before it returns (it used to come back after two others, two per request).
    for _ in range(3):
        batch = _ids(await _next(harness, me, sid, total - 1))
        assert len(batch) == len(set(batch)) == total - 1
        for track_id in batch:
            last = len(served) - 1 - served[::-1].index(track_id)
            assert len(served) - last >= total - 1, "came back too early"
            served.append(track_id)


async def test_like_and_dislike_are_exclusive(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    track = catalog_data.tracks[0]
    sid = (await _start(harness, me, limit=5))["session_id"]

    async def liked() -> bool:
        ids = (await harness.client.get("/v1/me/library", headers=me)).json()["tracks"]
        return str(track.id) in ids

    async def in_wave() -> bool:
        return str(track.id) in _ids((await _start(harness, me, limit=50))["tracks"])

    await _feedback(harness, me, sid, track, "liked")
    assert await liked()
    await _feedback(harness, me, sid, track, "disliked")
    assert not await liked()  # a dislike takes the track out of the library
    assert not await in_wave()

    # Liking through the library (the heart anywhere in the app) takes the dislike back.
    saved = await harness.client.put(f"/v1/me/library/tracks/{track.id}", headers=me)
    assert saved.status_code == 204
    assert await liked()
    assert await in_wave()


async def test_play_events_are_bounded_by_what_is_possible(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    track = catalog_data.tracks[0]
    before = await _play_count(harness, track)

    # A timestamp without a zone is UTC (it used to answer 500 and lose the whole batch).
    naive = (datetime.now(UTC) - timedelta(hours=2)).replace(tzinfo=None).isoformat()
    assert (await _post_events(harness, me, [_play(track, 45_000, naive)]))["counted_plays"] == 1

    # 200 "plays" of one track in one request: stored, but only one of them can be a play.
    flood = await _post_events(harness, me, [_play(track, 45_000) for _ in range(200)])
    assert (flood["accepted"], flood["counted_plays"]) == (200, 1)
    assert await _play_count(harness, track) == before + 2

    # Listening time cannot exceed the track; a timestamp cannot be older than a week.
    await _post_events(harness, me, [_play(catalog_data.tracks[1], 24 * 3600 * 1000, "1970-01-01T00:00:00Z")])
    async with harness.ctx.sessionmaker() as s:
        row = (
            await s.scalars(
                select(ListeningHistory).where(ListeningHistory.track_id == catalog_data.tracks[1].id)
            )
        ).one()
    assert row.ms_played <= catalog_data.tracks[1].duration_ms + 5_000
    assert row.played_at > datetime.now(UTC) - timedelta(days=8)
    # Plays with the same timestamp stay separate rows in the history (they used to collapse).
    history = (await harness.client.get("/v1/me/history", headers=me, params={"limit": 50})).json()
    assert len(history["items"]) == 50

    # Honest repeats still count: the same track an hour apart.
    hour_ago = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    assert (await _post_events(harness, me, [_play(track, 45_000, hour_ago)]))["counted_plays"] == 1


async def test_concurrent_playlist_adds_keep_every_track(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    tracks = [str(t.id) for t in [*catalog_data.tracks, catalog_data.explicit_track]]
    assert len(tracks) >= 4
    created = await harness.client.post("/v1/me/playlists", headers=me, json={"title": "Вместе"})
    assert created.status_code == 201, created.text
    pid = created.json()["id"]

    responses = await asyncio.gather(
        *(
            harness.client.post(f"/v1/me/playlists/{pid}/tracks", headers=me, json={"track_ids": [t]})
            for t in tracks[:4]
        )
    )
    assert [r.status_code for r in responses] == [200] * 4
    playlist = (await harness.client.get(f"/v1/playlists/{pid}", headers=me)).json()
    assert {t["id"] for t in playlist["tracks"]} == set(tracks[:4])


async def test_lyrics_of_a_hidden_release_are_not_served(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    async with harness.ctx.sessionmaker() as s:
        hidden = (
            await s.scalars(select(Track).where(Track.release_id == catalog_data.hidden_release.id))
        ).first()
        assert hidden is not None
        hidden.has_lyrics = True
        s.add(
            Lyrics(
                track_id=hidden.id,
                type=LyricsType.STATIC,
                body={"text": "ещё не вышло"},
                source=LyricsSource.MANUAL,
            )
        )
        await s.commit()
        hidden_id = hidden.id
    assert (await harness.client.get(f"/v1/tracks/{hidden_id}", headers=me)).status_code == 404
    assert (await harness.client.get(f"/v1/tracks/{hidden_id}/lyrics", headers=me)).status_code == 404


async def test_huge_offsets_are_a_validation_error(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    response = await harness.client.get(
        "/v1/me/library/tracks", headers=me, params={"offset": 9223372036854775808}
    )
    assert response.status_code == 422
