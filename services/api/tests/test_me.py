from httpx import AsyncClient

from sonora_api.core.ids import uuid7
from sonora_api.models import Genre
from tests.conftest import Catalog, Harness, bearer, register


async def test_patch_me(client: AsyncClient) -> None:
    tokens = await register(client)
    response = await client.patch(
        "/v1/me",
        headers=bearer(tokens),
        json={"display_name": "  DJ Test ", "country": "RU", "explicit_filter": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["display_name"], body["country"], body["explicit_filter"]) == ("DJ Test", "RU", True)

    assert (
        await client.patch("/v1/me", headers=bearer(tokens), json={"country": "russia"})
    ).status_code == 422
    assert (
        await client.patch("/v1/me", headers=bearer(tokens), json={"display_name": None})
    ).status_code == 422
    cleared = await client.patch("/v1/me", headers=bearer(tokens), json={"country": None})
    assert cleared.json()["country"] is None


async def test_settings_defaults_and_merge_patch(client: AsyncClient) -> None:
    tokens = await register(client)
    defaults = (await client.get("/v1/me/settings", headers=bearer(tokens))).json()
    assert defaults["audio"]["crossfade_seconds"] == 0
    assert defaults["audio"]["wave_crossfade_seconds"] == 4
    assert defaults["equalizer"]["bands"] == [0.0] * 10

    patched = await client.patch(
        "/v1/me/settings",
        headers=bearer(tokens),
        json={
            "audio": {"crossfade_seconds": 6, "quality_wifi": "lossless"},
            "privacy": {"private_session": True},
        },
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["audio"]["crossfade_seconds"] == 6
    assert body["audio"]["quality_wifi"] == "lossless"
    assert body["audio"]["gapless"] is True  # untouched keys survive

    reset = await client.patch(
        "/v1/me/settings", headers=bearer(tokens), json={"audio": {"crossfade_seconds": None}}
    )
    assert reset.json()["audio"]["crossfade_seconds"] == 0
    assert reset.json()["audio"]["quality_wifi"] == "lossless"

    look = await client.patch(
        "/v1/me/settings",
        headers=bearer(tokens),
        json={
            "appearance": {"theme": "light", "accent": "custom", "custom_accent": "#12AB34"},
            "equalizer": {"custom_presets": [{"name": "Мой бас", "bands": [6, 5, 3, 1, 0, 0, 0, 0, 0, 0]}]},
        },
    )
    assert look.status_code == 200, look.text
    assert look.json()["appearance"]["theme"] == "light"
    assert look.json()["appearance"]["progress_style"] == "line"  # defaults fill the rest
    assert look.json()["equalizer"]["custom_presets"][0]["name"] == "Мой бас"

    for bad in (
        {"appearance": {"custom_accent": "purple"}},
        {"appearance": {"theme": "sepia"}},
        {"audio": {"crossfade_seconds": 13}},
        {"audio": {"unknown": 1}},
        {"equalizer": {"bands": [0, 1]}},
    ):
        response = await client.patch("/v1/me/settings", headers=bearer(tokens), json=bad)
        assert response.status_code == 422, bad
        assert response.json()["error"]["code"] == "validation_error"


async def test_devices_list_and_remote_sign_out(client: AsyncClient) -> None:
    web = await register(client)
    phone = (
        await client.post(
            "/v1/auth/login",
            json={
                "email": "listener@example.com",
                "password": "correct horse battery",
                "device": {"platform": "android", "name": "Pixel", "model": "Pixel 9"},
            },
        )
    ).json()
    devices = (await client.get("/v1/me/devices", headers=bearer(web))).json()
    assert {d["platform"] for d in devices} == {"web", "android"}
    assert [d["current"] for d in devices if d["id"] == web["device_id"]] == [True]

    response = await client.delete(f"/v1/me/devices/{phone['device_id']}", headers=bearer(web))
    assert response.status_code == 204
    assert (await client.get("/v1/me", headers=bearer(phone))).status_code == 401
    assert (await client.get("/v1/me", headers=bearer(web))).status_code == 200

    other = await register(client, email="other@example.com")
    foreign = await client.delete(f"/v1/me/devices/{web['device_id']}", headers=bearer(other))
    assert foreign.status_code == 404


async def test_onboarding(harness: Harness, catalog_data: Catalog) -> None:
    client = harness.client
    tokens = await register(client)
    async with harness.ctx.sessionmaker() as s:
        genre = Genre(id=uuid7(), slug="indie", name="Инди")
        s.add(genre)
        await s.commit()

    unknown = await client.post(
        "/v1/me/onboarding", headers=bearer(tokens), json={"artist_ids": [str(uuid7())]}
    )
    assert unknown.status_code == 422

    payload = {"artist_ids": [str(catalog_data.artist.id)] * 2, "genre_ids": [str(genre.id)]}
    done = await client.post("/v1/me/onboarding", headers=bearer(tokens), json=payload)
    assert done.status_code == 200
    assert done.json()["onboarding_completed"] is True
    # Idempotent: repeating doesn't fail on the existing follow.
    assert (await client.post("/v1/me/onboarding", headers=bearer(tokens), json=payload)).status_code == 200
    settings = (await client.get("/v1/me/settings", headers=bearer(tokens))).json()
    assert settings["taste"]["genre_ids"] == [str(genre.id)]
