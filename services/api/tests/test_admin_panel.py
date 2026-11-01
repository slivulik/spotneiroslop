import io
import uuid
from typing import Any

from PIL import Image

from sonora_api.models import Track
from sonora_api.models.enums import TrackStatus
from tests.conftest import DEVICE, Catalog, Harness, bearer, make_admin, register

PUBLIC = "sonora-public"


def png(color: tuple[int, int, int] = (200, 40, 90), size: tuple[int, int] = (800, 800)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


async def _image(h: Harness, admin: dict[str, Any], kind: str = "playlist") -> dict[str, Any]:
    response = await h.client.post(
        "/v1/admin/images",
        params={"kind": kind},
        headers=bearer(admin),
        files={"file": ("cover.png", png(), "image/png")},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


# --- platform switches & blocking -----------------------------------------------------------


async def test_platform_switches_take_effect(harness: Harness) -> None:
    admin = await make_admin(harness)
    patched = await harness.client.patch(
        "/v1/admin/platform",
        headers=bearer(admin),
        json={
            "registration_open": False,
            "announcement": {"enabled": True, "text": "Новый альбом!", "tone": "accent"},
        },
    )
    assert patched.status_code == 200
    assert patched.json()["registration_open"] is False
    public = (await harness.client.get("/v1/platform")).json()
    assert public["announcement"]["text"] == "Новый альбом!"
    assert public["maintenance"] is None

    closed = await harness.client.post(
        "/v1/auth/register",
        json={
            "email": "late@example.com",
            "password": "long password 1",
            "display_name": "x",
            "device": DEVICE,
        },
    )
    assert closed.status_code == 403
    assert closed.json()["error"]["code"] == "registration_closed"
    bad = await harness.client.patch(
        "/v1/admin/platform", headers=bearer(admin), json={"max_quality": "ultra"}
    )
    assert bad.status_code == 422


async def test_blocking_cuts_access_immediately(harness: Harness) -> None:
    admin = await make_admin(harness)
    victim = await register(harness.client, email="victim@example.com")
    blocked = await harness.client.patch(
        f"/v1/admin/users/{victim['user']['id']}",
        headers=bearer(admin),
        json={"blocked": True, "block_reason": "спам"},
    )
    assert blocked.status_code == 200
    assert blocked.json()["block_reason"] == "спам"
    assert (await harness.client.get("/v1/me", headers=bearer(victim))).status_code == 401  # session revoked
    login = await harness.client.post(
        "/v1/auth/login",
        json={"email": "victim@example.com", "password": "correct horse battery", "device": DEVICE},
    )
    assert login.status_code == 403
    assert login.json()["error"]["code"] == "account_blocked"
    refresh = await harness.client.post("/v1/auth/refresh", json={"refresh_token": victim["refresh_token"]})
    assert refresh.status_code == 401

    await harness.client.patch(
        f"/v1/admin/users/{victim['user']['id']}", headers=bearer(admin), json={"blocked": False}
    )
    again = await harness.client.post(
        "/v1/auth/login",
        json={"email": "victim@example.com", "password": "correct horse battery", "device": DEVICE},
    )
    assert again.status_code == 200


async def test_user_admin_guards(harness: Harness) -> None:
    admin = await make_admin(harness)
    me = admin["user"]["id"]
    self_block = await harness.client.patch(
        f"/v1/admin/users/{me}", headers=bearer(admin), json={"blocked": True}
    )
    assert self_block.json()["error"]["code"] == "self_action"
    listener = await register(harness.client, email="l@example.com")
    promoted = await harness.client.patch(
        f"/v1/admin/users/{listener['user']['id']}", headers=bearer(admin), json={"role": "admin"}
    )
    assert promoted.json()["role"] == "admin"
    page = (await harness.client.get("/v1/admin/users", headers=bearer(admin), params={"q": "l@ex"})).json()
    assert page["total"] == 1
    signed = await harness.client.post(
        f"/v1/admin/users/{listener['user']['id']}/sign-out", headers=bearer(admin)
    )
    assert signed.json()["devices"] == 1
    assert (
        await harness.client.delete(f"/v1/admin/users/{listener['user']['id']}", headers=bearer(admin))
    ).status_code == 204
    assert (await harness.client.get("/v1/admin/users", headers=bearer(admin))).json()["total"] == 1


# --- images, playlists, genres, home ------------------------------------------------------


async def test_image_upload_produces_renditions(harness: Harness) -> None:
    admin = await make_admin(harness)
    image = await _image(harness, admin)
    assert image["key"].startswith("images/playlist/")
    assert image["palette"]["dominant"].startswith("#")
    stored = [k for (bucket, k) in harness.storage.contents if bucket == PUBLIC]
    assert len(stored) == 18  # 6 sizes × 3 formats
    hero = await _image(harness, admin, "hero")
    assert hero["artwork"]["sizes"] == [640, 1280, 1920, 2560]
    garbage = await harness.client.post(
        "/v1/admin/images",
        params={"kind": "genre"},
        headers=bearer(admin),
        files={"file": ("x.png", b"nope", "image/png")},
    )
    assert garbage.status_code == 422
    assert garbage.json()["error"]["code"] == "invalid_image"


async def test_editorial_playlist_lifecycle(harness: Harness, catalog_data: Catalog) -> None:
    admin = await make_admin(harness)
    cover = await _image(harness, admin)
    created = await harness.client.post(
        "/v1/admin/playlists",
        headers=bearer(admin),
        json={
            "title": "Ночной драйв",
            "description": "Для дороги",
            "cover": {"key": cover["key"], "blurhash": cover["blurhash"]},
        },
    )
    assert created.status_code == 201
    pid = created.json()["id"]
    a, b, c = (str(t.id) for t in catalog_data.tracks)
    tracks = await harness.client.put(
        f"/v1/admin/playlists/{pid}/tracks", headers=bearer(admin), json={"track_ids": [c, a, b, a]}
    )
    assert [t["id"] for t in tracks.json()["tracks"]] == [c, a, b]  # order kept, duplicate dropped
    unknown = await harness.client.put(
        f"/v1/admin/playlists/{pid}/tracks", headers=bearer(admin), json={"track_ids": [str(uuid.uuid4())]}
    )
    assert unknown.status_code == 422

    public = (await harness.client.get(f"/v1/playlists/{pid}")).json()
    assert public["title"] == "Ночной драйв"
    assert public["artwork"]["url_template"].endswith("/{size}.{format}")
    assert public["track_count"] == 3
    assert len(public["mosaic"]) == 1  # all three tracks are from one album

    await harness.client.patch(f"/v1/admin/playlists/{pid}", headers=bearer(admin), json={"is_public": False})
    assert (await harness.client.get(f"/v1/playlists/{pid}")).status_code == 404
    assert (
        await harness.client.delete(f"/v1/admin/playlists/{pid}", headers=bearer(admin))
    ).status_code == 204


async def test_genres_admin_and_detail(harness: Harness, catalog_data: Catalog) -> None:
    admin = await make_admin(harness)
    genre = (
        await harness.client.post(
            "/v1/admin/genres", headers=bearer(admin), json={"name": "Синти-поп", "color": "#7C5CFF"}
        )
    ).json()
    assert genre["slug"] == "sinti-pop"
    dup = await harness.client.post("/v1/admin/genres", headers=bearer(admin), json={"name": "Синти поп"})
    assert dup.json()["error"]["code"] == "slug_taken"
    track = catalog_data.tracks[0]
    await harness.client.patch(
        f"/v1/admin/tracks/{track.id}", headers=bearer(admin), json={"genres": ["Синти-поп"]}
    )
    detail = (await harness.client.get("/v1/genres/sinti-pop")).json()
    assert [t["id"] for t in detail["tracks"]] == [str(track.id)]
    assert detail["releases"][0]["title"] == "Tides"
    listing = (await harness.client.get("/v1/admin/genres", headers=bearer(admin))).json()
    assert listing[0]["track_count"] == 1


async def test_home_default_then_builder(harness: Harness, catalog_data: Catalog) -> None:
    default = (await harness.client.get("/v1/home")).json()
    assert default["is_default"] is True
    titles = [s["title"] for s in default["sections"]]
    assert "Свежие релизы" in titles
    assert "Популярное сейчас" in titles
    assert "Продолжить слушать" not in titles  # guests have no history; empty blocks are dropped

    admin = await make_admin(harness)
    hero_image = await _image(harness, admin, "hero")
    bad = await harness.client.post(
        "/v1/admin/home/sections",
        headers=bearer(admin),
        json={"type": "releases", "title": "Пусто", "config": {"source": "manual"}},
    )
    assert bad.status_code == 422
    hero = await harness.client.post(
        "/v1/admin/home/sections",
        headers=bearer(admin),
        json={
            "type": "hero",
            "title": "Tides — новый альбом",
            "subtitle": "Слушайте первыми",
            "config": {
                "image": {"key": hero_image["key"], "blurhash": hero_image["blurhash"]},
                "link": {"type": "release", "id": str(catalog_data.album.id)},
                "cta_label": "Слушать",
            },
        },
    )
    assert hero.status_code == 201, hero.text
    shelf = await harness.client.post(
        "/v1/admin/home/sections",
        headers=bearer(admin),
        json={
            "type": "releases",
            "title": "Выбор редакции",
            "config": {"source": "manual", "ids": [str(catalog_data.single.id), str(catalog_data.album.id)]},
        },
    )
    hidden = await harness.client.post(
        "/v1/admin/home/sections",
        headers=bearer(admin),
        json={"type": "tracks", "title": "Скрытый", "is_active": False, "config": {"source": "popular"}},
    )
    order = [shelf.json()["id"], hero.json()["id"], hidden.json()["id"]]
    assert (
        await harness.client.put("/v1/admin/home/order", headers=bearer(admin), json={"ids": order})
    ).status_code == 200

    page = (await harness.client.get("/v1/home")).json()
    assert page["is_default"] is False
    assert [s["title"] for s in page["sections"]] == ["Выбор редакции", "Tides — новый альбом"]
    assert [r["title"] for r in page["sections"][0]["releases"]] == ["Afterglow", "Tides"]
    assert page["sections"][1]["hero"]["artwork"]["sizes"] == [640, 1280, 1920, 2560]

    preview = await harness.client.post(
        "/v1/admin/home/preview",
        headers=bearer(admin),
        json={"type": "tracks", "title": "Тест", "config": {"source": "popular", "limit": 2}},
    )
    assert len(preview.json()["sections"][0]["tracks"]) == 2
    seed = await harness.client.post("/v1/admin/home/seed", headers=bearer(admin))
    assert seed.json()["error"]["code"] == "home_not_empty"


# --- catalogue management -------------------------------------------------------------------


async def test_track_metadata_lyrics_and_delete(harness: Harness, catalog_data: Catalog) -> None:
    admin = await make_admin(harness)
    track = catalog_data.tracks[1]
    listing = (
        await harness.client.get("/v1/admin/tracks", headers=bearer(admin), params={"q": "guest voice"})
    ).json()
    assert [t["id"] for t in listing["items"]] == [str(track.id)]  # found by featured artist name

    patched = await harness.client.patch(
        f"/v1/admin/tracks/{track.id}",
        headers=bearer(admin),
        json={
            "title": "Тайды",
            "version": "Remastered",
            "is_explicit": True,
            "isrc": "RUA012500002",
            "artists": [{"name": "Night Shore", "role": "main"}, {"name": "Новый Гость", "role": "feat"}],
            "credits": [{"name": "А. Автор", "role": "composer"}],
        },
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert (body["title"], body["version"], body["isrc"]) == ("Тайды", "Remastered", "RUA012500002")
    assert [(a["name"], a["role"]) for a in body["artists"]] == [
        ("Night Shore", "main"),
        ("Новый Гость", "feat"),
    ]
    no_main = await harness.client.patch(
        f"/v1/admin/tracks/{track.id}",
        headers=bearer(admin),
        json={"artists": [{"name": "X", "role": "feat"}]},
    )
    assert no_main.status_code == 422

    lrc = "[00:01.00]Первая строка\n[00:05.50]Вторая"
    synced = await harness.client.put(
        f"/v1/admin/tracks/{track.id}/lyrics", headers=bearer(admin), json={"format": "lrc", "text": lrc}
    )
    assert synced.json()["lyrics"]["format"] == "lrc"
    assert synced.json()["lyrics"]["text"] == "[00:01.00]Первая строка\n[00:05.50]Вторая"
    listener = await register(harness.client)
    lyrics = (await harness.client.get(f"/v1/tracks/{track.id}/lyrics", headers=bearer(listener))).json()
    assert [line["start_ms"] for line in lyrics["lines"]] == [1000, 5500]
    assert lyrics["lines"][-1]["end_ms"] == track.duration_ms
    not_lrc = await harness.client.put(
        f"/v1/admin/tracks/{track.id}/lyrics",
        headers=bearer(admin),
        json={"format": "lrc", "text": "просто текст"},
    )
    assert not_lrc.json()["error"]["code"] == "invalid_lrc"

    harness.storage.objects[("sonora-media", f"tracks/{track.id}/job/hls/master.m3u8")] = 10
    assert (
        await harness.client.delete(f"/v1/admin/tracks/{track.id}", headers=bearer(admin))
    ).status_code == 204
    assert not [k for k in harness.storage.objects if k[1].startswith(f"tracks/{track.id}/")]
    release = (
        await harness.client.get(f"/v1/admin/releases/{catalog_data.album.id}", headers=bearer(admin))
    ).json()
    assert release["track_count"] == 2  # aggregates refreshed


async def test_release_and_artist_editing(harness: Harness, catalog_data: Catalog) -> None:
    admin = await make_admin(harness)
    cover = await _image(harness, admin, "release")
    rid = catalog_data.single.id
    patched = await harness.client.patch(
        f"/v1/admin/releases/{rid}",
        headers=bearer(admin),
        json={
            "title": "Afterglow (Deluxe)",
            "type": "ep",
            "label": "Sonora Records",
            "cover": {"key": cover["key"]},
            "artists": ["Night Shore", "Guest Voice"],
        },
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert (body["title"], body["type"], body["label"]) == ("Afterglow (Deluxe)", "ep", "Sonora Records")
    assert [a["name"] for a in body["artists"]] == ["Night Shore", "Guest Voice"]
    assert cover["key"] in body["artwork"]["url_template"]

    hidden = await harness.client.patch(
        f"/v1/admin/releases/{rid}", headers=bearer(admin), json={"status": "hidden"}
    )
    assert hidden.json()["status"] == "hidden"
    assert (await harness.client.get(f"/v1/releases/{rid}")).status_code == 404

    artist = catalog_data.artist
    edited = await harness.client.patch(
        f"/v1/admin/artists/{artist.id}",
        headers=bearer(admin),
        json={"bio": "Группа из Мурманска", "verified": True},
    )
    assert (edited.json()["bio"], edited.json()["verified"]) == ("Группа из Мурманска", True)
    clash = await harness.client.patch(
        f"/v1/admin/artists/{artist.id}", headers=bearer(admin), json={"name": "Guest Voice"}
    )
    assert clash.json()["error"]["code"] == "name_taken"

    assert (
        await harness.client.delete(f"/v1/admin/releases/{rid}", headers=bearer(admin))
    ).status_code == 204
    assert (await harness.client.get(f"/v1/tracks/{catalog_data.explicit_track.id}")).status_code == 404
    hits = (
        await harness.client.get(
            "/v1/admin/search", headers=bearer(admin), params={"q": "tides", "kind": ["release"]}
        )
    ).json()
    assert [h["title"] for h in hits] == ["Tides"]


# --- events & dashboards ----------------------------------------------------------------


async def test_play_events_counting_and_streaming_dashboard(harness: Harness, catalog_data: Catalog) -> None:
    listener = await register(harness.client)
    admin = await make_admin(harness)
    track = catalog_data.tracks[0]
    start = {"event_id": str(uuid.uuid4()), "type": "play_start", "track_id": str(track.id)}
    assert (
        await harness.client.post("/v1/events/batch", headers=bearer(listener), json={"events": [start]})
    ).status_code == 200
    live = (await harness.client.get("/v1/admin/streaming", headers=bearer(admin))).json()
    assert [entry["track"]["id"] for entry in live["listening_now"]] == [str(track.id)]

    full = {"event_id": str(uuid.uuid4()), "type": "play_end", "track_id": str(track.id), "ms_played": 45_000}
    skip = {"event_id": str(uuid.uuid4()), "type": "play_end", "track_id": str(track.id), "ms_played": 5_000}
    result = (
        await harness.client.post("/v1/events/batch", headers=bearer(listener), json={"events": [full, skip]})
    ).json()
    assert result == {"accepted": 2, "duplicates": 0, "counted_plays": 1}
    replay = (
        await harness.client.post("/v1/events/batch", headers=bearer(listener), json={"events": [full]})
    ).json()
    assert replay["duplicates"] == 1

    async with harness.ctx.sessionmaker() as s:
        row = await s.get(Track, track.id)
        assert row is not None
        assert row.play_count == 51  # fixture had 50

    dash = (await harness.client.get("/v1/admin/streaming", headers=bearer(admin))).json()
    assert dash["listening_now"] == []  # play_end clears the live entry
    assert dash["plays_today"] == 1
    assert dash["top_tracks"][0]["track"]["id"] == str(track.id)
    assert len(dash["daily"]) == 14
    stats = (await harness.client.get("/v1/admin/stats", headers=bearer(admin))).json()
    assert stats["plays_today"] == 1
    assert stats["users"] == 2

    recent = (await harness.client.get("/v1/me/recent", headers=bearer(listener))).json()
    assert [t["id"] for t in recent["items"]] == [str(track.id)]
    home = (await harness.client.get("/v1/home", headers=bearer(listener))).json()
    assert home["sections"][0]["title"] == "Продолжить слушать"


async def test_quality_switches_clamp_streams(harness: Harness, catalog_data: Catalog) -> None:
    from sonora_api.models.enums import Quality  # noqa: PLC0415
    from tests.test_stream import _make_streamable  # noqa: PLC0415

    admin = await make_admin(harness)
    track = catalog_data.tracks[0]
    await _make_streamable(harness, track, [Quality.HIRES, Quality.LOSSLESS, Quality.HIGH])
    await harness.client.patch(
        "/v1/admin/platform", headers=bearer(admin), json={"hires_enabled": False, "guest_previews": False}
    )
    listener = await register(harness.client)
    stream = (
        await harness.client.get(
            f"/v1/tracks/{track.id}/stream", headers=bearer(listener), params={"quality": "hires"}
        )
    ).json()
    assert stream["quality"] == "lossless"
    assert "hires" not in stream["qualities"]
    assert (await harness.client.get(f"/v1/tracks/{track.id}/preview")).status_code == 404
    async with harness.ctx.sessionmaker() as s:
        row = await s.get(Track, track.id)
        assert row is not None
        assert row.status == TrackStatus.READY
