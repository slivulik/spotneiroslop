"""Open-catalogue search and import (Jamendo, Internet Archive). HTTP is a mock transport."""

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.models import UploadJob
from sonora_api.models.enums import JobStatus
from sonora_api.routers.admin_sources import get_sources
from sonora_api.services.sources.base import is_allowed_url
from sonora_api.services.sources.internet_archive import escape_query, item_tracks, parse_length
from sonora_api.services.sources.licenses import License, parse_license
from sonora_api.services.sources.registry import GLOBALLY_DISABLED, SourceRegistry
from tests.conftest import Catalog, Harness, bearer, make_admin, make_settings, register

Handler = Callable[[httpx.Request], httpx.Response]
JAMENDO_KEY = "test-key"


def use_sources(harness: Harness, handler: Handler, **settings: Any) -> None:
    registry = SourceRegistry(make_settings(**settings), transport=httpx.MockTransport(handler))
    harness.app.dependency_overrides[get_sources] = lambda: registry


# ---------------------------------------------------------------------------
# Fixtures: what the real APIs answer (trimmed to the fields we read)
# ---------------------------------------------------------------------------


def jamendo_row(track_id: int, **changes: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(track_id),
        "name": f"Песня {track_id}",
        "duration": 125,
        "artist_id": "7",
        "artist_name": "Tymono",
        "album_name": "From My Soul",
        "album_id": "30449",
        "license_ccurl": "http://creativecommons.org/licenses/by-nc-sa/3.0/",
        "position": 6,
        "releasedate": "2008-08-23",
        "album_image": f"https://usercontent.jamendo.com?type=album&id=30449&width=600&trackid={track_id}",
        "image": f"https://usercontent.jamendo.com?type=album&id=30449&width=600&trackid={track_id}",
        "audio": f"https://prod-1.storage.jamendo.com/?trackid={track_id}&format=mp32&from=abc",
        "audiodownload": f"https://prod-1.storage.jamendo.com/download/track/{track_id}/flac/",
        "audiodownload_allowed": True,
        "prourl": "",
        "shorturl": f"https://jamen.do/t/{track_id}",
        "shareurl": f"https://www.jamendo.com/track/{track_id}",
    }
    row.update(changes)
    return row


JAMENDO_ROWS = [
    jamendo_row(205088),
    jamendo_row(205089, license_ccurl="https://creativecommons.org/publicdomain/zero/1.0/"),
    jamendo_row(205090, audiodownload_allowed=False, audiodownload=""),  # artist forbids downloads
    jamendo_row(205091, license_ccurl=""),  # no licence: never listed
    jamendo_row(205092, license_ccurl="https://example.com/all-rights-reserved"),
]


def jamendo_api(rows: list[dict[str, Any]], seen: list[httpx.Request] | None = None) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.host != "api.jamendo.com" or request.url.path != "/v3.0/tracks/":
            return httpx.Response(404)
        params = request.url.params
        if params.get("client_id") != JAMENDO_KEY:
            body = {"headers": {"status": "failed", "code": 5, "error_message": "Invalid client id"}}
            return httpx.Response(200, json=body)
        fmt = params.get("audiodlformat", "mp32")
        ids = set(params.get("id", "").split())
        results = [
            {**row, "audiodownload": row["audiodownload"].replace("/flac/", f"/{fmt}/")}
            for row in rows
            if not ids or row["id"] in ids
        ]
        headers = {"status": "success", "code": 0, "error_message": "", "results_count": len(results)}
        return httpx.Response(200, json={"headers": headers, "results": results})

    return handler


ARCHIVE_ITEM: dict[str, Any] = {
    "metadata": {
        "identifier": "night-shore-live",
        "mediatype": "audio",
        "title": "Live at the Pier",
        "creator": "Night Shore",
        "date": "2019-06-01",
        "licenseurl": "http://creativecommons.org/licenses/by-sa/4.0/",
    },
    "files": [
        {"name": "01 Tide.flac", "source": "original", "format": "Flac", "title": "Tide", "track": "1",
         "length": "125.40"},
        {"name": "01 Tide.mp3", "source": "derivative", "format": "VBR MP3", "original": "01 Tide.flac",
         "length": "125.41"},
        {"name": "01 Tide.ogg", "source": "derivative", "format": "Ogg Vorbis", "original": "01 Tide.flac"},
        {"name": "02 Undertow.mp3", "source": "original", "format": "MP3", "title": "Undertow",
         "track": "2/3", "length": "03:05", "artist": "Night Shore feat. Guest"},
        {"name": "02 Undertow_64kb.mp3", "source": "derivative", "format": "64Kbps MP3",
         "original": "02 Undertow.mp3"},
        {"name": "03 Interlude.ogg", "source": "original", "format": "Ogg Vorbis", "title": "Interlude"},
        {"name": "night-shore-live_spectrogram.png", "source": "derivative", "format": "Spectrogram",
         "original": "01 Tide.flac"},
        {"name": "cover.jpg", "source": "original", "format": "JPEG"},
    ],
}  # fmt: skip
ARCHIVE_DOCS = [
    {"identifier": "night-shore-live", "licenseurl": "http://creativecommons.org/licenses/by-sa/4.0/"},
    {"identifier": "rights-reserved", "licenseurl": "http://rightsstatements.org/vocab/InC/1.0/"},
    {"identifier": "no-licence"},
]


def archive_api(metadata: dict[str, dict[str, Any]], seen: list[httpx.Request] | None = None) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.host != "archive.org":
            return httpx.Response(404)
        if request.url.path == "/advancedsearch.php":
            body = {"response": {"numFound": len(ARCHIVE_DOCS), "start": 0, "docs": ARCHIVE_DOCS}}
            return httpx.Response(200, json=body)
        if request.url.path.startswith("/metadata/"):
            return httpx.Response(200, json=metadata.get(request.url.path.removeprefix("/metadata/"), {}))
        return httpx.Response(404)

    return handler


# ---------------------------------------------------------------------------
# Licences and parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("http://creativecommons.org/licenses/by-nc-sa/3.0/", "CC BY-NC-SA 3.0"),
        ("https://creativecommons.org/licenses/by/4.0/legalcode", "CC BY 4.0"),
        ("https://creativecommons.org/licenses/by-sa/4.0/deed.ru", "CC BY-SA 4.0"),
        ("http://creativecommons.org/licenses/by-sa/3.0/de/", "CC BY-SA 3.0 DE"),
        ("http://creativecommons.org/licenses/by-nd-nc/1.0/", "CC BY-NC-ND 1.0"),
        ("creativecommons.org/licenses/by/2.5/", "CC BY 2.5"),
        ("https://creativecommons.org/publicdomain/zero/1.0/", "CC0 1.0"),
        ("http://creativecommons.org/publicdomain/mark/1.0/", "Public Domain Mark 1.0"),
        ("http://creativecommons.org/licenses/publicdomain/", "Public Domain"),
    ],
)
def test_free_licences_get_readable_codes(url: str, code: str) -> None:
    parsed = parse_license(url)
    assert parsed is not None
    assert parsed.code == code
    assert parsed.url is not None
    assert parsed.url.startswith("https://creativecommons.org/")


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "http://rightsstatements.org/vocab/InC/1.0/",
        "http://www.gnu.org/licenses/gpl.html",
        "https://example.com/licenses/by/4.0/",
        "https://creativecommons.org.evil.example/licenses/by/4.0/",
        "https://creativecommons.org/licenses/by-nd-sa/2.0/",  # not a real licence
        "https://creativecommons.org/licenses/sampling+/1.0/",  # retired, no sharing of the whole work
        "https://creativecommons.org/licenses/by/9.0/",
        "https://creativecommons.org/licenses/",
    ],
)
def test_everything_else_is_not_free(url: str | None) -> None:
    assert parse_license(url) is None


def test_download_allow_list() -> None:
    assert is_allowed_url("https://prod-1.storage.jamendo.com/download/track/1/flac/")
    assert is_allowed_url("https://archive.org/download/x/a.flac")
    assert is_allowed_url("https://ia800204.us.archive.org/2/items/x/a.flac")
    assert not is_allowed_url("http://archive.org/download/x/a.flac")  # plain HTTP
    assert not is_allowed_url("https://evilarchive.org/a.flac")
    assert not is_allowed_url("https://archive.org.evil.example/a.flac")
    assert not is_allowed_url("https://archive.org@evil.example/a.flac")
    assert not is_allowed_url("https://archive.org:8443/a.flac")


def test_archive_helpers() -> None:
    assert parse_length("351.4") == 351
    assert parse_length("05:51") == 351
    assert parse_length("1:02:03") == 3723
    assert parse_length("n/a") is None
    assert escape_query('AC/DC: "live"') == 'AC\\/DC\\: \\"live\\"'


def test_archive_item_groups_derivatives_and_prefers_flac() -> None:
    best, every = item_tracks("night-shore-live", ARCHIVE_ITEM)
    assert [t.external_id for t in best] == [
        "night-shore-live/01 Tide.flac",
        "night-shore-live/02 Undertow.mp3",
    ]
    tide, undertow = best
    assert (tide.title, tide.artist, tide.album, tide.format) == (
        "Tide",
        "Night Shore",
        "Live at the Pier",
        "flac",
    )
    assert tide.duration_s == 125
    assert tide.track_number == 1
    assert tide.license == License("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/")
    assert tide.download_url == "https://archive.org/download/night-shore-live/01%20Tide.flac"
    assert tide.preview_url == "https://archive.org/download/night-shore-live/01%20Tide.mp3"
    assert tide.page_url == "https://archive.org/details/night-shore-live"
    assert tide.artwork_url == "https://archive.org/services/img/night-shore-live"
    # MP3 original beats the 64 kbps derivative; the light one is the preview.
    assert (undertow.format, undertow.duration_s, undertow.track_number) == ("mp3", 185, 2)
    assert undertow.artist == "Night Shore feat. Guest"
    assert undertow.preview_url is not None
    assert undertow.preview_url.endswith("02%20Undertow_64kb.mp3")
    # Every pipeline-compatible file can be imported by id; Ogg-only recordings can't.
    assert "night-shore-live/01 Tide.mp3" in every
    assert not any("Interlude" in key or key.endswith(".ogg") for key in every)


def test_archive_item_without_free_licence_or_credit_yields_nothing() -> None:
    reserved = {**ARCHIVE_ITEM, "metadata": {**ARCHIVE_ITEM["metadata"], "licenseurl": "http://x.org/eula"}}
    assert item_tracks("night-shore-live", reserved) == ([], {})
    anonymous = {
        "metadata": {"licenseurl": "https://creativecommons.org/licenses/by/4.0/"},
        "files": [{"name": "a.flac", "source": "original", "format": "Flac"}],
    }
    assert item_tracks("anon", anonymous) == ([], {})


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


async def test_source_routes_are_admin_only(harness: Harness) -> None:
    listener = await register(harness.client)
    for method, url in [
        ("GET", "/v1/admin/sources"),
        ("GET", "/v1/admin/sources/internet_archive/search?q=jazz"),
        ("POST", "/v1/admin/sources/internet_archive/import"),
    ]:
        body = {"external_ids": ["x/y.flac"]} if method == "POST" else None
        anonymous = await harness.client.request(method, url, json=body)
        assert anonymous.status_code == 401
        forbidden = await harness.client.request(method, url, json=body, headers=bearer(listener))
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "forbidden"


async def test_jamendo_without_key_is_disabled_with_a_hint(harness: Harness) -> None:
    admin = await make_admin(harness)
    sources = (await harness.client.get("/v1/admin/sources", headers=bearer(admin))).json()
    by_key = {s["key"]: s for s in sources}
    assert set(by_key) == {"jamendo", "internet_archive"}
    assert by_key["jamendo"]["enabled"] is False
    assert "https://devportal.jamendo.com" in by_key["jamendo"]["disabled_reason"]
    assert "SONORA_JAMENDO_CLIENT_ID" in by_key["jamendo"]["disabled_reason"]
    assert by_key["internet_archive"] == {
        "key": "internet_archive",
        "title": "Internet Archive",
        "description": by_key["internet_archive"]["description"],
        "enabled": True,
        "disabled_reason": None,
    }
    search = await harness.client.get(
        "/v1/admin/sources/jamendo/search", params={"q": "rock"}, headers=bearer(admin)
    )
    assert search.status_code == 409
    assert search.json()["error"]["code"] == "source_disabled"
    unknown = await harness.client.get("/v1/admin/sources/spotify/search?q=x", headers=bearer(admin))
    assert unknown.status_code == 422


async def test_global_switch_disables_every_source(harness: Harness) -> None:
    admin = await make_admin(harness)
    use_sources(harness, archive_api({}), sources_enabled=False, jamendo_client_id=JAMENDO_KEY)
    sources = (await harness.client.get("/v1/admin/sources", headers=bearer(admin))).json()
    assert [(s["enabled"], s["disabled_reason"]) for s in sources] == [(False, GLOBALLY_DISABLED)] * 2
    search = await harness.client.get(
        "/v1/admin/sources/internet_archive/search", params={"q": "x"}, headers=bearer(admin)
    )
    assert search.status_code == 409


async def test_jamendo_search_lists_only_free_downloadable_tracks(
    harness: Harness, catalog_data: Catalog, db: AsyncSession
) -> None:
    admin = await make_admin(harness)
    seen: list[httpx.Request] = []
    use_sources(harness, jamendo_api(JAMENDO_ROWS, seen), jamendo_client_id=JAMENDO_KEY)
    imported = catalog_data.tracks[0]
    imported.source_name, imported.source_external_id = "jamendo", "205089"
    await db.commit()

    response = await harness.client.get(
        "/v1/admin/sources/jamendo/search", params={"q": " tymono ", "limit": 10}, headers=bearer(admin)
    )
    assert response.status_code == 200, response.text
    tracks = response.json()
    assert [t["external_id"] for t in tracks] == ["205088", "205089"]
    first = tracks[0]
    assert first == {
        "source": "jamendo",
        "external_id": "205088",
        "title": "Песня 205088",
        "artist": "Tymono",
        "album": "From My Soul",
        "duration_s": 125,
        "license": {"code": "CC BY-NC-SA 3.0", "url": "https://creativecommons.org/licenses/by-nc-sa/3.0/"},
        "artwork_url": "https://usercontent.jamendo.com?type=album&id=30449&width=600&trackid=205088",
        "preview_url": "https://prod-1.storage.jamendo.com/?trackid=205088&format=mp32&from=abc",
        "page_url": "https://www.jamendo.com/track/205088",
        "format": "flac",
        "already_imported": False,
    }
    assert tracks[1]["license"]["code"] == "CC0 1.0"
    assert tracks[1]["already_imported"] is True
    params = seen[0].url.params
    assert (params["search"], params["limit"], params["audiodlformat"]) == ("tymono", "10", "flac")


async def test_upstream_failures_are_bad_gateway_not_500(harness: Harness) -> None:
    admin = await make_admin(harness)

    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    use_sources(harness, offline, jamendo_client_id=JAMENDO_KEY)
    for key in ("jamendo", "internet_archive"):
        response = await harness.client.get(
            f"/v1/admin/sources/{key}/search", params={"q": "x"}, headers=bearer(admin)
        )
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "source_unavailable"

    use_sources(harness, jamendo_api(JAMENDO_ROWS), jamendo_client_id="revoked")
    rejected = await harness.client.get(
        "/v1/admin/sources/jamendo/search", params={"q": "x"}, headers=bearer(admin)
    )
    assert rejected.status_code == 502
    assert "SONORA_JAMENDO_CLIENT_ID" in rejected.json()["error"]["message"]

    use_sources(harness, lambda request: httpx.Response(503, text="<html>down</html>"))
    down = await harness.client.get(
        "/v1/admin/sources/internet_archive/search", params={"q": "x"}, headers=bearer(admin)
    )
    assert down.status_code == 502


async def test_archive_search_maps_items_to_tracks(harness: Harness) -> None:
    admin = await make_admin(harness)
    seen: list[httpx.Request] = []
    use_sources(harness, archive_api({"night-shore-live": ARCHIVE_ITEM}, seen))
    response = await harness.client.get(
        "/v1/admin/sources/internet_archive/search", params={"q": "night: shore"}, headers=bearer(admin)
    )
    assert response.status_code == 200, response.text
    tracks = response.json()
    assert [(t["title"], t["format"], t["already_imported"]) for t in tracks] == [
        ("Tide", "flac", False),
        ("Undertow", "mp3", False),
    ]
    assert tracks[0]["license"] == {
        "code": "CC BY-SA 4.0",
        "url": "https://creativecommons.org/licenses/by-sa/4.0/",
    }
    query = seen[0].url.params["q"]
    assert query.startswith("(night\\: shore) AND mediatype:(audio)")
    assert "licenseurl:(*creativecommons.org*)" in query
    # Items without a free licence are dropped before their metadata is even fetched.
    assert [r.url.path for r in seen[1:]] == ["/metadata/night-shore-live"]


async def test_import_creates_jobs_from_server_resolved_data(harness: Harness, db: AsyncSession) -> None:
    admin = await make_admin(harness)
    use_sources(harness, jamendo_api(JAMENDO_ROWS), jamendo_client_id=JAMENDO_KEY)
    response = await harness.client.post(
        "/v1/admin/sources/jamendo/import",
        headers=bearer(admin),
        # Anything but ids is ignored: download URLs always come from the source itself.
        json={
            "external_ids": ["205088", "205089", "205088"],
            "publish": True,
            "download_url": "https://evil.example/x.flac",
        },
    )
    assert response.status_code == 202, response.text
    jobs = response.json()
    assert len(jobs) == 2
    assert all(j["status"] == "queued" and j["files"] == [] and j["completed_stages"] == [] for j in jobs)
    options = jobs[0]["options"]
    assert options == {
        "publish": True,
        "allow_duplicate": False,
        "source": "jamendo",
        "external_id": "205088",
        "download_url": "https://prod-1.storage.jamendo.com/download/track/205088/flac/",
        "fallback_url": "https://prod-1.storage.jamendo.com/download/track/205088/mp32/",
        "format": "flac",
        "license": {"code": "CC BY-NC-SA 3.0", "url": "https://creativecommons.org/licenses/by-nc-sa/3.0/"},
        "attribution": "Tymono",
        "page_url": "https://www.jamendo.com/track/205088",
        "source_meta": {
            "title": "Песня 205088",
            "artist": "Tymono",
            "album": "From My Soul",
            "duration_s": 125,
            "artwork_url": "https://usercontent.jamendo.com?type=album&id=30449&width=600&trackid=205088",
            "release_date": "2008-08-23",
            "track_number": 6,
        },
    }
    assert jobs[1]["options"]["license"]["code"] == "CC0 1.0"
    assert len(harness.broker.queues["media"].queue) == 2
    rows = list(await db.scalars(select(UploadJob)))
    assert {str(r.id) for r in rows} == {j["id"] for j in jobs}
    assert all(r.status == JobStatus.QUEUED and r.admin_id is not None for r in rows)

    # Listed in «Загрузка» like any upload.
    listing = (await harness.client.get("/v1/admin/uploads", headers=bearer(admin))).json()
    assert {j["id"] for j in listing["items"]} == {j["id"] for j in jobs}

    # Still queued: importing the same recording again is refused.
    again = await harness.client.post(
        "/v1/admin/sources/jamendo/import", headers=bearer(admin), json={"external_ids": ["205088"]}
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_imported"
    assert again.json()["error"]["details"]["external_ids"] == ["205088"]


async def test_import_rejects_unknown_and_non_free_ids(harness: Harness, db: AsyncSession) -> None:
    admin = await make_admin(harness)
    use_sources(harness, jamendo_api(JAMENDO_ROWS), jamendo_client_id=JAMENDO_KEY)
    response = await harness.client.post(
        "/v1/admin/sources/jamendo/import",
        headers=bearer(admin),
        json={"external_ids": ["205088", "999", "205091", "../etc/passwd"]},
    )
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "source_items_not_found"
    assert error["details"]["external_ids"] == ["999", "205091", "../etc/passwd"]
    assert len(harness.broker.queues["media"].queue) == 0
    assert list(await db.scalars(select(UploadJob))) == []

    empty = await harness.client.post(
        "/v1/admin/sources/jamendo/import", headers=bearer(admin), json={"external_ids": []}
    )
    assert empty.status_code == 422
    too_many = await harness.client.post(
        "/v1/admin/sources/jamendo/import",
        headers=bearer(admin),
        json={"external_ids": [str(i) for i in range(51)]},
    )
    assert too_many.status_code == 422


async def test_import_refuses_recordings_already_in_catalogue(
    harness: Harness, catalog_data: Catalog, db: AsyncSession
) -> None:
    admin = await make_admin(harness)
    use_sources(harness, archive_api({"night-shore-live": ARCHIVE_ITEM}))
    track = catalog_data.tracks[1]
    track.source_name, track.source_external_id = "internet_archive", "night-shore-live/01 Tide.flac"
    await db.commit()

    search = await harness.client.get(
        "/v1/admin/sources/internet_archive/search", params={"q": "tide"}, headers=bearer(admin)
    )
    assert [t["already_imported"] for t in search.json()] == [True, False]
    refused = await harness.client.post(
        "/v1/admin/sources/internet_archive/import",
        headers=bearer(admin),
        json={"external_ids": ["night-shore-live/01 Tide.flac", "night-shore-live/02 Undertow.mp3"]},
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["external_ids"] == ["night-shore-live/01 Tide.flac"]

    accepted = await harness.client.post(
        "/v1/admin/sources/internet_archive/import",
        headers=bearer(admin),
        json={"external_ids": ["night-shore-live/02 Undertow.mp3"]},
    )
    assert accepted.status_code == 202, accepted.text
    options = accepted.json()[0]["options"]
    assert options["download_url"] == "https://archive.org/download/night-shore-live/02%20Undertow.mp3"
    assert options["format"] == "mp3"
    assert options["fallback_url"] is None
    assert options["attribution"] == "Night Shore feat. Guest"
    assert options["page_url"] == "https://archive.org/details/night-shore-live"
    assert options["source_meta"]["album"] == "Live at the Pier"


async def test_track_out_exposes_licence_of_imported_tracks(
    harness: Harness, catalog_data: Catalog, db: AsyncSession
) -> None:
    imported, own, _ = catalog_data.tracks
    imported.license_code = "CC BY-SA 4.0"
    imported.license_url = "https://creativecommons.org/licenses/by-sa/4.0/"
    imported.source_name = "jamendo"
    imported.source_external_id = "205088"
    imported.source_url = "https://www.jamendo.com/track/205088"
    imported.attribution = "Tymono"
    await db.commit()

    body = (await harness.client.get(f"/v1/tracks/{imported.id}")).json()
    assert body["license"] == {
        "code": "CC BY-SA 4.0",
        "url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "source": "Jamendo",
        "source_url": "https://www.jamendo.com/track/205088",
        "attribution": "Tymono",
    }
    assert (await harness.client.get(f"/v1/tracks/{own.id}")).json()["license"] is None
    release = (await harness.client.get(f"/v1/releases/{catalog_data.album.id}")).json()
    licences = {t["id"]: t["license"] for t in release["tracks"]}
    assert licences[str(imported.id)]["source"] == "Jamendo"
    assert licences[str(own.id)] is None
