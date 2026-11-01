"""Recommendations on real data: wave, mixes, similar artists, artist statistics."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from sonora_api.core.ids import uuid7
from sonora_api.models import Genre, ListeningHistory, TrackGenre, User
from tests.conftest import Catalog, Harness, bearer, make_artist, make_release, make_track, register


async def _user_id(harness: Harness, email: str):
    async with harness.ctx.sessionmaker() as s:
        return await s.scalar(select(User.id).where(User.email == email))


async def test_wave_mixes_similar_and_stats(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    await register(harness.client, email="peer@example.com")
    me_id, peer_id = (
        await _user_id(harness, "listener@example.com"),
        await _user_id(harness, "peer@example.com"),
    )
    now = datetime.now(UTC)
    async with harness.ctx.sessionmaker() as s:
        # A second artist that the peer listens to together with Night Shore.
        other = make_artist("Echo Valley")
        s.add(other)
        await s.flush()
        rel = make_release("Valley", other)
        s.add(rel)
        await s.flush()
        valley = [make_track(rel, i, other, plays=10 * i) for i in (1, 2)]
        s.add_all(valley)
        rock = Genre(id=uuid7(), slug="rock", name="Рок")
        s.add(rock)
        await s.flush()
        for t in [*catalog_data.tracks, *valley]:
            s.add(TrackGenre(track_id=t.id, genre_id=rock.id))
        seed = catalog_data.tracks[0]
        for minutes, uid, track in [
            (5, me_id, seed), (60, me_id, seed), (90, me_id, catalog_data.tracks[1]),
            (10, peer_id, seed), (20, peer_id, valley[0]), (30, peer_id, valley[1]),
        ]:  # fmt: skip
            s.add(
                ListeningHistory(
                    user_id=uid,
                    track_id=track.id,
                    ms_played=60_000,
                    counted=True,
                    played_at=now - timedelta(minutes=minutes),
                )
            )
        await s.commit()

    wave = (await harness.client.get("/v1/me/wave", headers=me, params={"limit": 5})).json()
    ids = [t["id"] for t in wave]
    assert len(ids) == len(set(ids)) > 0
    assert str(valley[0].id) in ids or str(valley[1].id) in ids  # co-listening surfaces the peer's artist
    excluded = (
        await harness.client.get(
            "/v1/me/wave", headers=me, params=[("limit", 5), *[("exclude", i) for i in ids]]
        )
    ).json()
    assert not set(ids) & {t["id"] for t in excluded}

    mixes = (await harness.client.get("/v1/me/mixes", headers=me)).json()
    keys = [m["key"] for m in mixes]
    assert f"genre:{rock.id}" in keys
    assert f"artist:{catalog_data.artist.id}" in keys
    mix = (await harness.client.get(f"/v1/me/mixes/genre:{rock.id}", headers=me)).json()
    assert mix["title"] == "Микс: Рок"
    assert len(mix["tracks"]) >= 3
    assert (await harness.client.get("/v1/me/mixes/genre:nope", headers=me)).status_code in (404, 422)

    similar = (await harness.client.get(f"/v1/artists/{catalog_data.artist.id}/similar")).json()
    assert similar[0]["name"] == "Echo Valley"
    stats = (await harness.client.get(f"/v1/artists/{catalog_data.artist.id}/stats")).json()
    assert stats["monthly_listeners"] == 2
    assert stats["plays_30d"] == 4
    assert len(stats["weekly"]) == 12
    assert stats["genres"][0]["name"] == "Рок"
    assert sum(w["plays"] for w in stats["weekly"]) == 4
    artist = (await harness.client.get(f"/v1/artists/{catalog_data.artist.id}")).json()
    assert artist["monthly_listeners"] == 2
    top = (await harness.client.get("/v1/me/top-artists", headers=me)).json()
    assert top[0]["name"] == "Night Shore"


async def test_cold_start_wave_uses_popular_and_new(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    wave = (await harness.client.get("/v1/me/wave", headers=me, params={"limit": 3})).json()
    assert 0 < len(wave) <= 3
    assert (await harness.client.get("/v1/me/mixes", headers=me)).json() == []  # no genres yet, no fake mixes
