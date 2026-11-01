import uuid

from httpx import AsyncClient
from structlog.testing import capture_logs

from sonora_api.core.ids import uuid7
from sonora_api.models import Genre, Mood
from sonora_api.models.enums import ReleaseType
from tests.conftest import Catalog, Harness, bearer, make_release, register


async def test_track_detail_shape_and_badges(client: AsyncClient, catalog_data: Catalog) -> None:
    hires, feat, mp3 = catalog_data.tracks
    body = (await client.get(f"/v1/tracks/{hires.id}")).json()
    assert body["title"] == "Tides #1"
    assert body["audio"] == {"lossless": True, "hires": True}
    assert body["playable"] is False  # guests only get previews
    assert body["release"]["artwork"]["url_template"].startswith("https://cdn.test/media/covers/")
    assert body["release"]["artwork"]["palette"]["dominant"] == "#112233"
    assert body["artists"][0]["name"] == "Night Shore"

    assert (await client.get(f"/v1/tracks/{mp3.id}")).json()["audio"] == {"lossless": False, "hires": False}
    roles = [(a["name"], a["role"]) for a in (await client.get(f"/v1/tracks/{feat.id}")).json()["artists"]]
    assert roles == [("Night Shore", "main"), ("Guest Voice", "feat")]


async def test_hidden_tracks_are_not_found(client: AsyncClient, catalog_data: Catalog) -> None:
    assert (await client.get(f"/v1/tracks/{catalog_data.processing_track.id}")).status_code == 404
    assert (await client.get(f"/v1/releases/{catalog_data.hidden_release.id}")).status_code == 404
    assert (await client.get(f"/v1/tracks/{uuid.uuid4()}")).status_code == 404


async def test_batch_tracks_preserves_order_and_skips_unknown(
    client: AsyncClient, catalog_data: Catalog
) -> None:
    a, b, _ = catalog_data.tracks
    ids = [b.id, uuid.uuid4(), a.id, b.id, catalog_data.processing_track.id]
    response = await client.get("/v1/tracks", params={"ids": ",".join(map(str, ids))})
    assert [t["id"] for t in response.json()["items"]] == [str(b.id), str(a.id)]

    assert (await client.get("/v1/tracks", params={"ids": "nope"})).status_code == 422
    too_many = ",".join(str(uuid.uuid4()) for _ in range(101))
    assert (await client.get("/v1/tracks", params={"ids": too_many})).status_code == 422


async def test_explicit_filter_marks_tracks_unplayable(client: AsyncClient, catalog_data: Catalog) -> None:
    tokens = await register(client)
    url = f"/v1/tracks/{catalog_data.explicit_track.id}"
    assert (await client.get(url, headers=bearer(tokens))).json()["playable"] is True
    await client.patch("/v1/me", headers=bearer(tokens), json={"explicit_filter": True})
    assert (await client.get(url, headers=bearer(tokens))).json()["playable"] is False


async def test_release_detail_lists_only_visible_tracks_in_order(
    client: AsyncClient, catalog_data: Catalog
) -> None:
    body = (await client.get(f"/v1/releases/{catalog_data.album.id}")).json()
    assert [t["track_number"] for t in body["tracks"]] == [1, 2, 3]
    assert body["track_count"] == 3
    assert body["total_duration_ms"] == sum(t["duration_ms"] for t in body["tracks"])
    assert body["artists"][0]["slug"] == catalog_data.artist.slug


async def test_artist_and_top_tracks(client: AsyncClient, catalog_data: Catalog) -> None:
    artist = (await client.get(f"/v1/artists/{catalog_data.artist.id}")).json()
    assert artist["name"] == "Night Shore"
    assert artist["artwork"] is None

    top = (await client.get(f"/v1/artists/{catalog_data.artist.id}/top-tracks")).json()["items"]
    # Sorted by plays; processing and embargoed tracks never appear despite huge play counts.
    assert [t["title"] for t in top] == ["Afterglow #1", "Tides #2", "Tides #1", "Tides #3"]
    feat_top = (await client.get(f"/v1/artists/{catalog_data.feat_artist.id}/top-tracks")).json()["items"]
    assert [t["title"] for t in feat_top] == ["Tides #2"]
    assert (await client.get(f"/v1/artists/{uuid.uuid4()}/top-tracks")).status_code == 404


async def test_artist_releases_cursor_pagination(harness: Harness, catalog_data: Catalog) -> None:
    client = harness.client
    async with harness.ctx.sessionmaker() as s:
        s.add_all(
            [
                make_release(f"Old {i}", catalog_data.artist, type_=ReleaseType.EP, released=None)
                for i in range(3)
            ]
        )
        await s.commit()
    url = f"/v1/artists/{catalog_data.artist.id}/releases"

    seen: list[str] = []
    cursor = None
    while True:
        params: dict[str, str | int] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = (await client.get(url, params=params)).json()
        seen += [r["title"] for r in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen[:2] == ["Afterglow", "Tides"]  # newest first, undated releases last
    assert sorted(seen[2:]) == ["Old 0", "Old 1", "Old 2"]
    assert len(seen) == len(set(seen)) == 5

    singles = (await client.get(url, params={"type": "single"})).json()["items"]
    assert [r["title"] for r in singles] == ["Afterglow"]
    bad = await client.get(url, params={"cursor": "!!!"})
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "invalid_cursor"


async def test_etag_and_cache_headers(client: AsyncClient, catalog_data: Catalog) -> None:
    url = f"/v1/releases/{catalog_data.album.id}"
    first = await client.get(url)
    assert first.headers["cache-control"].startswith("public, max-age=300")
    etag = first.headers["etag"]
    cached = await client.get(url, headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.content == b""

    tokens = await register(client)
    private = await client.get(url, headers=bearer(tokens))
    assert private.headers["cache-control"].startswith("private")
    assert "Authorization" in private.headers["vary"]


async def test_genres_and_moods(harness: Harness) -> None:
    async with harness.ctx.sessionmaker() as s:
        s.add_all(
            [
                Genre(id=uuid7(), slug="rock", name="Рок", position=2),
                Genre(id=uuid7(), slug="pop", name="Поп", position=1, cover_key="genres/pop"),
                Mood(id=uuid7(), slug="calm", name="Спокойное", color="#336699"),
            ]
        )
        await s.commit()
    genres = (await harness.client.get("/v1/genres")).json()["items"]
    assert [g["slug"] for g in genres] == ["pop", "rock"]
    assert genres[0]["artwork"]["url_template"] == "https://cdn.test/media/genres/pop/{size}.{format}"
    moods = (await harness.client.get("/v1/moods")).json()["items"]
    assert moods[0]["color"] == "#336699"


async def test_health(client: AsyncClient) -> None:
    assert (await client.get("/healthz")).json()["status"] == "ok"
    ready = await client.get("/readyz")
    assert ready.status_code == 200
    assert ready.json()["checks"] == {"postgres": "ok", "redis": "ok"}


async def test_request_id_is_propagated(client: AsyncClient) -> None:
    response = await client.get("/healthz", headers={"X-Request-ID": "client-supplied-123"})
    assert response.headers["x-request-id"] == "client-supplied-123"
    generated = await client.get("/healthz", headers={"X-Request-ID": "bad id with spaces"})
    assert generated.headers["x-request-id"] != "bad id with spaces"


async def test_access_log_records_full_route_template(client: AsyncClient, catalog_data: Catalog) -> None:
    with capture_logs() as logs:
        await client.get(f"/v1/tracks/{catalog_data.tracks[0].id}")
    access = [entry for entry in logs if entry["event"] == "request"]
    assert access[-1]["route"] == "/v1/tracks/{track_id}"
    assert access[-1]["status"] == 200
