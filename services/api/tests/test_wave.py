"""Wave 2.0: sessions with settings, feedback, and the server's memory of what it served."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from sonora_api.core.ids import uuid7
from sonora_api.models import Dislike, Genre, ListeningHistory, Track, TrackGenre, User, WaveSession
from tests.conftest import Catalog, Harness, bearer, make_artist, make_release, make_track, register

NO_SETTINGS: dict[str, str | None] = {"character": None, "mood": None, "language": None}


async def _user_id(harness: Harness, email: str = "listener@example.com") -> uuid.UUID:
    async with harness.ctx.sessionmaker() as s:
        user_id = await s.scalar(select(User.id).where(User.email == email))
    assert user_id is not None
    return user_id


async def _artist_tracks(harness: Harness, name: str, count: int) -> list[Track]:
    """`count` singles by a new artist, each on its own release (no diversity rule in the way)."""
    async with harness.ctx.sessionmaker() as s:
        artist = make_artist(name)
        s.add(artist)
        await s.flush()
        releases = [make_release(f"{name} {i}", artist) for i in range(count)]
        s.add_all(releases)
        await s.flush()
        tracks = [make_track(release, 1, artist) for release in releases]
        s.add_all(tracks)
        await s.commit()
    return tracks


async def _genre(harness: Harness, slug: str, name: str, *tracks: Track) -> Genre:
    async with harness.ctx.sessionmaker() as s:
        genre = Genre(id=uuid7(), slug=slug, name=name)
        s.add(genre)
        await s.flush()
        s.add_all(TrackGenre(track_id=t.id, genre_id=genre.id) for t in tracks)
        await s.commit()
    return genre


async def _start(harness: Harness, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    response = await harness.client.post("/v1/me/wave/sessions", headers=headers, json=body)
    assert response.status_code == 201, response.text
    out: dict[str, Any] = response.json()
    return out


async def _next(
    harness: Harness, headers: dict[str, str], session_id: str, limit: int
) -> list[dict[str, Any]]:
    response = await harness.client.get(
        f"/v1/me/wave/sessions/{session_id}/next", headers=headers, params={"limit": limit}
    )
    assert response.status_code == 200, response.text
    out: list[dict[str, Any]] = response.json()
    return out


async def _feedback(
    harness: Harness,
    headers: dict[str, str],
    session_id: str,
    track: Track,
    action: str,
    played_ms: int | None = None,
) -> None:
    body: dict[str, Any] = {"track_id": str(track.id), "action": action, "played_ms": played_ms}
    response = await harness.client.post(
        f"/v1/me/wave/sessions/{session_id}/feedback", headers=headers, json=body
    )
    assert response.status_code == 204, response.text


def _ids(tracks: list[dict[str, Any]]) -> list[str]:
    return [t["id"] for t in tracks]


def _visible(catalog: Catalog, *more: Track) -> set[str]:
    return {str(t.id) for t in [*catalog.tracks, catalog.explicit_track, *more]}


async def test_session_persists_settings_and_never_repeats(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    valley = await _artist_tracks(harness, "Echo Valley", 3)
    everything = _visible(catalog_data, *valley)  # 7 playable tracks

    started = await _start(harness, me, limit=3)
    assert started["settings"] == NO_SETTINGS
    sid = started["session_id"]
    served = _ids(started["tracks"])
    assert len(served) == 3
    async with harness.ctx.sessionmaker() as s:
        row = await s.get(WaveSession, uuid.UUID(sid))
        assert row is not None
        assert (row.user_id, row.seed_type, row.seed_id) == (await _user_id(harness), "user", None)
        assert row.settings == NO_SETTINGS

    while len(served) < len(everything):
        batch = _ids(await _next(harness, me, sid, 3))
        assert batch, "never empty while unheard tracks are left"
        served += batch
    assert len(served) == len(set(served)) == len(everything)  # never a repeat
    assert set(served) == everything

    # The catalogue is exhausted: tracks come back, but never the one that just played.
    again = _ids(await _next(harness, me, sid, 3))
    assert again
    assert served[-1] not in again


async def test_radio_session_from_a_track(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    seed = catalog_data.tracks[0]
    started = await _start(harness, me, seed_track=str(seed.id), limit=10)
    assert started["tracks"]
    assert str(seed.id) not in _ids(started["tracks"])
    async with harness.ctx.sessionmaker() as s:
        row = await s.get(WaveSession, uuid.UUID(started["session_id"]))
        assert row is not None
        assert (row.seed_type, row.seed_id) == ("track", seed.id)
    assert str(seed.id) not in _ids(await _next(harness, me, started["session_id"], 10))

    unknown = await harness.client.post("/v1/me/wave/sessions", headers=me, json={"seed_track": str(uuid7())})
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "not_found")


async def test_latest_settings(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    url = "/v1/me/wave/settings"
    assert (await harness.client.get(url, headers=me)).json() == NO_SETTINGS

    await _start(harness, me, settings={"character": "discover", "mood": "calm"})
    assert (await harness.client.get(url, headers=me)).json() == {
        "character": "discover",
        "mood": "calm",
        "language": None,
    }
    await _start(harness, me, settings={"language": "russian"})
    assert (await harness.client.get(url, headers=me)).json() == {**NO_SETTINGS, "language": "russian"}

    other = bearer(await register(harness.client, email="other@example.com"))
    assert (await harness.client.get(url, headers=other)).json() == NO_SETTINGS
    bad = await harness.client.post("/v1/me/wave/sessions", headers=me, json={"settings": {"mood": "angry"}})
    assert bad.status_code == 422


async def test_language_filter_and_relaxation(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    kino = {str(t.id) for t in await _artist_tracks(harness, "Кино", 2)}

    russian = await _start(harness, me, settings={"language": "russian"}, limit=10)
    assert set(_ids(russian["tracks"])) == kino  # only the Cyrillic tracks while there are any
    # Nothing Russian is left: the language filter relaxes instead of leaving the wave empty.
    relaxed = _ids(await _next(harness, me, russian["session_id"], 10))
    assert relaxed
    assert not set(relaxed) & kino

    foreign = await _start(harness, me, settings={"language": "foreign"}, limit=10)
    assert foreign["tracks"]
    assert not set(_ids(foreign["tracks"])) & kino


async def test_every_setting_still_plays_something(harness: Harness, catalog_data: Catalog) -> None:
    """Whatever the settings, a catalogue with playable music never yields an empty wave."""
    me = bearer(await register(harness.client))
    await _genre(harness, "classical", "Classical", catalog_data.tracks[0])
    sweep: list[dict[str, str]] = [
        *({"character": c} for c in ("favorite", "discover", "popular")),
        *({"mood": m} for m in ("energetic", "happy", "calm", "sad")),
        *({"language": lang} for lang in ("russian", "foreign", "instrumental")),
        {"character": "discover", "mood": "sad", "language": "instrumental"},
    ]
    for settings in sweep:
        started = await _start(harness, me, settings=settings, limit=5)
        assert started["tracks"], settings
        assert started["settings"] == {**NO_SETTINGS, **settings}
        assert await _next(harness, me, started["session_id"], 5), settings


async def test_mood_from_genre_names(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    calm, loud = catalog_data.tracks[0], catalog_data.tracks[1]
    await _genre(harness, "ambient", "Ambient", calm)
    await _genre(harness, "heavy-metal", "Heavy Metal", loud)

    started = await _start(harness, me, settings={"mood": "calm"}, limit=10)
    first = _ids(started["tracks"])
    assert str(calm.id) in first
    assert str(loud.id) not in first  # the opposite mood is filtered out; unknown tracks stay
    assert len(first) == 3
    assert _ids(await _next(harness, me, started["session_id"], 10)) == [str(loud.id)]  # relaxed


async def test_character_settings(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    valley = {str(t.id) for t in await _artist_tracks(harness, "Echo Valley", 3)}
    heard = catalog_data.tracks[0]
    async with harness.ctx.sessionmaker() as s:
        s.add(
            ListeningHistory(
                user_id=await _user_id(harness),
                track_id=heard.id,
                ms_played=120_000,
                counted=True,
                played_at=datetime.now(UTC) - timedelta(hours=2),
            )
        )
        await s.commit()

    discover = await _start(harness, me, settings={"character": "discover"}, limit=10)
    assert discover["tracks"]
    assert str(heard.id) not in _ids(discover["tracks"])

    # Favourite: what they play and the artists they play, nobody new.
    favorite = await _start(harness, me, settings={"character": "favorite"}, limit=10)
    assert str(heard.id) in _ids(favorite["tracks"])
    assert all(str(catalog_data.artist.id) in {a["id"] for a in t["artists"]} for t in favorite["tracks"])

    # Popular: tracks people actually play (the new artist has no plays yet).
    popular = await _start(harness, me, settings={"character": "popular"}, limit=10)
    assert popular["tracks"]
    assert not set(_ids(popular["tracks"])) & valley


async def test_early_skip_pushes_the_artist_down(harness: Harness) -> None:
    me = bearer(await register(harness.client))
    alpha = await _artist_tracks(harness, "Alpha", 4)
    beta = {str(t.id) for t in await _artist_tracks(harness, "Beta", 4)}
    sid = (await _start(harness, me, limit=1))["session_id"]

    await _feedback(harness, me, sid, alpha[0], "skipped", played_ms=4_000)
    batch = _ids(await _next(harness, me, sid, 2))
    assert len(batch) == 2
    assert set(batch) <= beta


async def test_like_feedback_likes_the_track(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    sid = (await _start(harness, me, limit=2))["session_id"]
    track = catalog_data.tracks[2]
    await _feedback(harness, me, sid, track, "liked")
    await _feedback(harness, me, sid, track, "liked")  # idempotent
    await _feedback(harness, me, sid, track, "finished", played_ms=180_000)
    library = (await harness.client.get("/v1/me/library", headers=me)).json()
    assert library["tracks"] == [str(track.id)]


async def test_dislikes_never_play_in_any_wave(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    valley = await _artist_tracks(harness, "Echo Valley", 2)
    sid = (await _start(harness, me, limit=1))["session_id"]
    disliked = catalog_data.tracks[1]
    await _feedback(harness, me, sid, disliked, "disliked")
    await _feedback(harness, me, sid, disliked, "disliked")  # idempotent
    async with harness.ctx.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(Dislike)) == 1

    assert str(disliked.id) not in _ids(await _next(harness, me, sid, 50))
    assert str(disliked.id) not in _ids((await _start(harness, me, limit=50))["tracks"])
    old_wave = (await harness.client.get("/v1/me/wave", headers=me, params={"limit": 50})).json()
    assert old_wave
    assert str(disliked.id) not in _ids(old_wave)

    # A whole artist, for as long as `until` says.
    valley_ids = {str(t.id) for t in valley}
    async with harness.ctx.sessionmaker() as s:
        s.add(
            Dislike(
                id=uuid7(),
                user_id=await _user_id(harness),
                artist_id=valley[0].artist_links[0].artist_id,
                until=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await s.commit()
    old_wave = (await harness.client.get("/v1/me/wave", headers=me, params={"limit": 50})).json()
    assert not set(_ids(old_wave)) & valley_ids
    assert not set(_ids((await _start(harness, me, limit=50))["tracks"])) & valley_ids
    async with harness.ctx.sessionmaker() as s:
        row = await s.scalar(select(Dislike).where(Dislike.artist_id.is_not(None)))
        assert row is not None
        row.until = datetime.now(UTC) - timedelta(minutes=1)
        await s.commit()
    old_wave = (await harness.client.get("/v1/me/wave", headers=me, params={"limit": 50})).json()
    assert valley_ids <= set(_ids(old_wave))  # the dislike has expired

    # Liking the track later lifts its dislike.
    await _feedback(harness, me, sid, disliked, "liked")
    old_wave = (await harness.client.get("/v1/me/wave", headers=me, params={"limit": 50})).json()
    assert str(disliked.id) in _ids(old_wave)


async def test_someone_elses_session_is_not_found(harness: Harness, catalog_data: Catalog) -> None:
    owner = bearer(await register(harness.client))
    sid = (await _start(harness, owner, limit=1))["session_id"]
    stranger = bearer(await register(harness.client, email="stranger@example.com"))
    track = str(catalog_data.tracks[0].id)

    for session_id in (sid, str(uuid7())):
        nxt = await harness.client.get(f"/v1/me/wave/sessions/{session_id}/next", headers=stranger)
        assert (nxt.status_code, nxt.json()["error"]["code"]) == (404, "not_found")
        fb = await harness.client.post(
            f"/v1/me/wave/sessions/{session_id}/feedback",
            headers=stranger,
            json={"track_id": track, "action": "liked"},
        )
        assert (fb.status_code, fb.json()["error"]["code"]) == (404, "not_found")
    assert (await harness.client.get("/v1/me/library", headers=stranger)).json()["tracks"] == []

    unknown_track = await harness.client.post(
        f"/v1/me/wave/sessions/{sid}/feedback",
        headers=owner,
        json={"track_id": str(uuid7()), "action": "finished"},
    )
    assert unknown_track.status_code == 404
    assert (await harness.client.get(f"/v1/me/wave/sessions/{sid}/next")).status_code == 401
