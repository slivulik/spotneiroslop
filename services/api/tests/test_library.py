"""Personal library: likes/follows, user playlists, histories, and typo-tolerant search."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from sonora_api.core.ids import uuid7
from sonora_api.models import ListeningHistory, User
from tests.conftest import Catalog, Harness, bearer, register


async def test_likes_are_idempotent_and_listed(harness: Harness, catalog_data: Catalog) -> None:
    me = await register(harness.client)
    h = bearer(me)
    track, album, artist = catalog_data.tracks[1], catalog_data.album, catalog_data.artist
    assert (await harness.client.get("/v1/me/library")).status_code == 401
    for _ in range(2):  # liking twice is still one like
        assert (await harness.client.put(f"/v1/me/library/tracks/{track.id}", headers=h)).status_code == 204
    await harness.client.put(f"/v1/me/library/releases/{album.id}", headers=h)
    await harness.client.put(f"/v1/me/library/artists/{artist.id}", headers=h)
    ids = (await harness.client.get("/v1/me/library", headers=h)).json()
    assert ids["tracks"] == [str(track.id)]
    assert ids["releases"] == [str(album.id)]
    assert ids["artists"] == [str(artist.id)]

    liked = (await harness.client.get("/v1/me/library/tracks", headers=h)).json()
    assert liked["total"] == 1
    assert liked["items"][0]["id"] == str(track.id)
    assert (await harness.client.get("/v1/me/library/releases", headers=h)).json()[0]["title"] == "Tides"
    assert (await harness.client.get("/v1/me/library/artists", headers=h)).json()[0]["name"] == "Night Shore"

    assert (await harness.client.delete(f"/v1/me/library/tracks/{track.id}", headers=h)).status_code == 204
    assert (await harness.client.delete(f"/v1/me/library/tracks/{track.id}", headers=h)).status_code == 204
    assert (await harness.client.get("/v1/me/library", headers=h)).json()["tracks"] == []
    missing = await harness.client.put(f"/v1/me/library/tracks/{uuid7()}", headers=h)
    assert missing.status_code == 404
    bad_kind = await harness.client.put(f"/v1/me/library/nope/{track.id}", headers=h)
    assert bad_kind.status_code == 422


async def test_user_playlist_lifecycle_and_ownership(harness: Harness, catalog_data: Catalog) -> None:
    me = bearer(await register(harness.client))
    other = bearer(await register(harness.client, email="other@example.com"))
    t1, t2, t3 = (str(t.id) for t in catalog_data.tracks)

    created = await harness.client.post(
        "/v1/me/playlists", headers=me, json={"title": "  Дорога  ", "track_ids": [t1, t2, t1]}
    )
    assert created.status_code == 201, created.text
    p = created.json()
    assert p["title"] == "Дорога"
    assert [t["id"] for t in p["tracks"]] == [t1, t2]  # duplicates dropped
    assert p["total_duration_ms"] == catalog_data.tracks[0].duration_ms + catalog_data.tracks[1].duration_ms
    pid = p["id"]

    added = (
        await harness.client.post(f"/v1/me/playlists/{pid}/tracks", headers=me, json={"track_ids": [t3, t1]})
    ).json()
    assert [t["id"] for t in added["tracks"]] == [t1, t2, t3]
    reordered = await harness.client.put(
        f"/v1/me/playlists/{pid}/order", headers=me, json={"track_ids": [t3, t1, t2]}
    )
    assert [t["id"] for t in reordered.json()["tracks"]] == [t3, t1, t2]
    stale = await harness.client.put(
        f"/v1/me/playlists/{pid}/order", headers=me, json={"track_ids": [t3, t1]}
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "playlist_conflict"
    removed = (await harness.client.delete(f"/v1/me/playlists/{pid}/tracks/{t1}", headers=me)).json()
    assert [t["id"] for t in removed["tracks"]] == [t3, t2]

    # Private: invisible to others, even by id.
    assert (await harness.client.get(f"/v1/playlists/{pid}", headers=other)).status_code == 404
    assert (
        await harness.client.patch(f"/v1/me/playlists/{pid}", headers=other, json={"title": "x"})
    ).status_code == 404
    # Public: readable and followable by others, but still not editable.
    await harness.client.patch(f"/v1/me/playlists/{pid}", headers=me, json={"is_public": True})
    assert (await harness.client.get(f"/v1/playlists/{pid}", headers=other)).status_code == 200
    forbidden = await harness.client.post(
        f"/v1/me/playlists/{pid}/tracks", headers=other, json={"track_ids": [t1]}
    )
    assert forbidden.status_code == 403
    assert (await harness.client.put(f"/v1/me/library/playlists/{pid}", headers=other)).status_code == 204
    others = (await harness.client.get("/v1/me/playlists", headers=other)).json()
    assert [(x["id"], x["owner_name"]) for x in others] == [(pid, "Listener")]

    mine = (await harness.client.get("/v1/me/playlists", headers=me)).json()
    assert [x["track_count"] for x in mine] == [2]
    assert (await harness.client.delete(f"/v1/me/playlists/{pid}", headers=me)).status_code == 204
    assert (await harness.client.get("/v1/me/playlists", headers=me)).json() == []
    assert (await harness.client.get("/v1/me/playlists", headers=other)).json() == []


async def test_histories(harness: Harness, catalog_data: Catalog) -> None:
    me = await register(harness.client)
    h = bearer(me)
    async with harness.ctx.sessionmaker() as s:
        user_id = await s.scalar(select(User.id).where(User.email == "listener@example.com"))
        now = datetime.now(UTC)
        for i, track in enumerate(catalog_data.tracks):
            s.add(
                ListeningHistory(
                    user_id=user_id,
                    track_id=track.id,
                    ms_played=40_000,
                    played_at=now - timedelta(minutes=10 - i),
                )
            )
        await s.commit()
    history = (await harness.client.get("/v1/me/history", headers=h)).json()["items"]
    assert [e["track"]["id"] for e in history] == [str(t.id) for t in reversed(catalog_data.tracks)]
    assert (await harness.client.delete("/v1/me/history", headers=h)).status_code == 204
    assert (await harness.client.get("/v1/me/history", headers=h)).json()["items"] == []

    for q in ["night", "tides", "night"]:
        assert (
            await harness.client.post("/v1/me/search-history", headers=h, json={"query": q})
        ).status_code == 204
    assert (await harness.client.get("/v1/me/search-history", headers=h)).json()["queries"] == [
        "night",
        "tides",
    ]
    await harness.client.delete("/v1/me/search-history", headers=h)
    assert (await harness.client.get("/v1/me/search-history", headers=h)).json()["queries"] == []

    popular = (await harness.client.get("/v1/search/popular")).json()
    assert popular["source"] == "plays"  # not enough searches yet: most played artists
    assert popular["queries"][0] == "Night Shore"


async def test_search_tolerates_typos_sorts_and_finds_genres(harness: Harness, catalog_data: Catalog) -> None:
    exact = (await harness.client.get("/v1/search", params={"q": "Afterglow"})).json()
    assert [r["title"] for r in exact["releases"]] == ["Afterglow"]
    typo = (await harness.client.get("/v1/search", params={"q": "Aftreglow"})).json()
    assert "Afterglow" in [r["title"] for r in typo["releases"]]
    artist_typo = (await harness.client.get("/v1/search", params={"q": "nigt shore"})).json()
    assert [a["name"] for a in artist_typo["artists"]] == ["Night Shore"]

    popular = (await harness.client.get("/v1/search", params={"q": "tides", "sort": "popular"})).json()
    plays = [t["title"] for t in popular["tracks"]]
    assert plays[0] == "Tides #2"  # 500 plays beats 50 and 5
    newest = (await harness.client.get("/v1/search", params={"q": "night", "sort": "new"})).json()
    assert newest["releases"][0]["title"] == "Afterglow"  # 2026 before 2025
    assert (await harness.client.get("/v1/search", params={"q": "x", "sort": "bogus"})).status_code == 422
    assert "genres" in exact
