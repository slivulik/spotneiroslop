"""Imports from open catalogues: the `fetch` stage and licence hand-over (HTTP is a mock)."""

import uuid
from collections.abc import Callable, Iterator
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
from sonora_api.models import Artist, Release, Track, TrackArtist, UploadJob
from sonora_api.models.enums import ArtistRole, JobStatus, ReleaseStatus
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from sonora_media import fetch
from sonora_media.errors import MediaError
from tests.conftest import AudioFiles, cover_png
from tests.test_pipeline import UPLOADS, Harness

FLAC_URL = "https://prod-1.storage.jamendo.com/download/track/205088/flac/"
MP3_URL = "https://prod-1.storage.jamendo.com/download/track/205088/mp32/"
COVER_URL = "https://usercontent.jamendo.com/?type=album&id=30449&width=600"
MB = 1024**2

Routes = dict[str, Callable[[], httpx.Response]]


def transport(routes: Routes, seen: list[str] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(str(request.url))
        make = routes.get(str(request.url))
        return make() if make else httpx.Response(404)

    return httpx.MockTransport(handler)


def file_response(path: Path, content_type: str) -> Callable[[], httpx.Response]:
    return lambda: httpx.Response(200, content=path.read_bytes(), headers={"content-type": content_type})


def redirect(location: str) -> Callable[[], httpx.Response]:
    return lambda: httpx.Response(302, headers={"location": location})


def import_options(external_id: str = "205088", **changes: Any) -> dict[str, Any]:
    options: dict[str, Any] = {
        "publish": True,
        "allow_duplicate": False,
        "source": "jamendo",
        "external_id": external_id,
        "download_url": FLAC_URL,
        "fallback_url": None,
        "format": "flac",
        "license": {"code": "CC BY-SA 3.0", "url": "https://creativecommons.org/licenses/by-sa/3.0/"},
        "attribution": "Tymono",
        "page_url": f"https://www.jamendo.com/track/{external_id}",
        "source_meta": {
            "title": "Морской бриз (feat. Гость)",
            "artist": "Tymono",
            "album": "From My Soul",
            "duration_s": 20,
            "artwork_url": COVER_URL,
            "release_date": "2008-08-23",
            "track_number": 3,
        },
    }
    options.update(changes)
    return options


def submit_import(h: Harness, options: dict[str, Any]) -> uuid.UUID:
    """What `POST /v1/admin/sources/{key}/import` writes: a queued job without files."""
    job_id = uuid.uuid4()
    with h.sessions.begin() as session:
        session.add(UploadJob(id=job_id, files=[], options=options, status=JobStatus.QUEUED))
    return job_id


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------


def test_sniff_recognises_flac_and_mp3_only(tmp_path: Path, audio: AudioFiles) -> None:
    assert fetch.sniff(audio.flac16) == "flac"
    assert fetch.sniff(audio.mp3) == "mp3"  # ID3v2 tag with an embedded cover first
    padded = tmp_path / "padded.mp3"
    padded.write_bytes(
        b"ID3\x04\x00\x00\x00\x00\x00\x04tag!" + b"\x00" * 50 + b"\xff\xfb\x90\x64" + b"\x00" * 100
    )
    assert fetch.sniff(padded) == "mp3"
    page = tmp_path / "error.flac"
    page.write_bytes(b"<!doctype html><title>404</title>")
    assert fetch.sniff(page) is None
    jpeg = tmp_path / "cover.mp3"
    jpeg.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 100)
    assert fetch.sniff(jpeg) is None


def test_download_follows_allowed_redirects(tmp_path: Path, audio: AudioFiles) -> None:
    final = "https://ia800204.us.archive.org/2/items/night-shore/01%20Tide.flac"
    seen: list[str] = []
    routes: Routes = {
        "https://archive.org/download/night-shore/01%20Tide.flac": redirect(final),
        final: file_response(audio.flac16, "audio/flac"),
    }
    got = fetch.download_audio(
        "https://archive.org/download/night-shore/01%20Tide.flac",
        tmp_path / "dl",
        max_bytes=50 * MB,
        timeout_seconds=60,
        transport=transport(routes, seen),
    )
    assert (got.kind, got.url, got.content_type) == ("flac", final, "audio/flac")
    assert got.path == tmp_path / "dl" / "source.flac"
    assert got.path.read_bytes() == audio.flac16.read_bytes()
    assert got.size_bytes == audio.flac16.stat().st_size
    assert len(seen) == 2


@pytest.mark.parametrize(
    ("url", "routes", "message"),
    [
        ("https://evil.example/a.flac", {}, "не разрешено"),
        ("http://archive.org/download/x/a.flac", {}, "не разрешено"),
        (FLAC_URL, {FLAC_URL: redirect("https://evil.example/steal")}, "не разрешено"),
        (FLAC_URL, {FLAC_URL: redirect(FLAC_URL)}, "Слишком много перенаправлений"),
        (FLAC_URL, {}, "ответил 404"),
        (
            FLAC_URL,
            {FLAC_URL: lambda: httpx.Response(200, html="<html>maintenance</html>")},
            "не аудиофайл",
        ),
        (
            FLAC_URL,
            {
                FLAC_URL: lambda: httpx.Response(
                    200,
                    content=b"PK\x03\x04zip",
                    headers={
                        "content-type": "application/octet-stream",
                        "content-disposition": 'attachment; filename="album.zip"',
                    },
                )
            },
            "не аудиофайл",
        ),
        (
            FLAC_URL,
            {
                FLAC_URL: lambda: httpx.Response(
                    200, content=b"definitely not audio", headers={"content-type": "application/octet-stream"}
                )
            },
            "не FLAC и не MP3",
        ),
    ],
)
def test_download_refuses_anything_suspicious(tmp_path: Path, url: str, routes: Routes, message: str) -> None:
    seen: list[str] = []
    with pytest.raises(MediaError, match=message):
        fetch.download_audio(
            url, tmp_path, max_bytes=MB, timeout_seconds=60, transport=transport(routes, seen)
        )
    if "evil" in url or url.startswith("http:"):
        assert seen == []  # never even connected
    assert not (tmp_path / "download.part").exists()


def test_download_size_cap(tmp_path: Path) -> None:
    declared: Routes = {FLAC_URL: lambda: httpx.Response(200, content=b"fLaC" + b"\x00" * 3000)}
    with pytest.raises(MediaError, match="больше"):
        fetch.download_audio(
            FLAC_URL, tmp_path, max_bytes=1000, timeout_seconds=60, transport=transport(declared)
        )

    def chunks() -> Iterator[bytes]:
        yield b"fLaC" + b"\x00" * 600
        yield b"\x00" * 600

    streamed: Routes = {FLAC_URL: lambda: httpx.Response(200, content=chunks())}  # no Content-Length
    with pytest.raises(MediaError, match="больше"):
        fetch.download_audio(
            FLAC_URL, tmp_path, max_bytes=1000, timeout_seconds=60, transport=transport(streamed)
        )
    assert not (tmp_path / "download.part").exists()


def test_cover_download_is_best_effort() -> None:
    png = cover_png(300)
    ok: Routes = {COVER_URL: lambda: httpx.Response(200, content=png, headers={"content-type": "image/png"})}
    assert fetch.download_image(COVER_URL, transport=transport(ok)) == png
    html: Routes = {COVER_URL: lambda: httpx.Response(200, html="<html></html>")}
    assert fetch.download_image(COVER_URL, transport=transport(html)) is None
    assert fetch.download_image("https://evil.example/c.png", transport=transport(ok)) is None


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def test_import_downloads_fills_tags_and_licenses_the_track(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    cover = cover_png()
    h.pipeline.http_transport = transport(
        {
            FLAC_URL: file_response(audio.other_flac, "audio/flac"),  # no tags at all
            COVER_URL: lambda: httpx.Response(200, content=cover, headers={"content-type": "image/png"}),
        }
    )
    job_id = submit_import(h, import_options())
    status = h.pipeline.run(job_id)
    job = h.job(job_id)
    assert status == JobStatus.SUCCEEDED, (job.stage, job.error)

    assert job.state["fetch"] == {
        "imported": True,
        "source": "jamendo",
        "external_id": "205088",
        "url": FLAC_URL,
        "key": f"jobs/{job_id}/source.flac",
        "size_bytes": audio.other_flac.stat().st_size,
        "format": "flac",
    }
    assert job.files == [
        {
            "role": "source",
            "key": f"jobs/{job_id}/source.flac",
            "filename": "Tymono — Морской бриз (feat. Гость).flac",
            "size_bytes": audio.other_flac.stat().st_size,
        }
    ]
    assert h.storage.path(UPLOADS, f"jobs/{job_id}/source.flac").read_bytes() == audio.other_flac.read_bytes()
    assert {w["code"] for w in job.warnings} == {"tags_from_source"}

    with sessions() as s:
        track = s.get(Track, job.track_id)
        assert track is not None
        assert (track.title, track.track_number) == ("Морской бриз", 3)
        assert (track.license_code, track.license_url) == (
            "CC BY-SA 3.0",
            "https://creativecommons.org/licenses/by-sa/3.0/",
        )
        assert (track.source_name, track.source_external_id, track.source_url, track.attribution) == (
            "jamendo",
            "205088",
            "https://www.jamendo.com/track/205088",
            "Tymono",
        )
        links = s.execute(
            select(Artist.name, TrackArtist.role)
            .join(TrackArtist, TrackArtist.artist_id == Artist.id)
            .where(TrackArtist.track_id == track.id)
            .order_by(TrackArtist.position)
        ).all()
        assert [tuple(row) for row in links] == [("Tymono", ArtistRole.MAIN), ("Гость", ArtistRole.FEAT)]
        release = s.get(Release, track.release_id)
        assert release is not None
        assert (release.title, release.status, release.release_date) == (
            "From My Soul",
            ReleaseStatus.PUBLISHED,
            date(2008, 8, 23),
        )
        assert release.cover_key is not None  # the catalogue's cover

    # The same recording can't be imported twice.
    again = submit_import(h, import_options())
    assert h.pipeline.run(again) == JobStatus.FAILED
    failed = h.job(again)
    assert failed.stage == "fetch"
    assert failed.error is not None
    assert "уже есть в каталоге" in failed.error


def test_import_falls_back_to_mp3_and_keeps_file_tags(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    storage_url = "https://storage-2.jamendo.com/tracks/205088.mp3"
    h.pipeline.http_transport = transport(
        {
            FLAC_URL: lambda: httpx.Response(404),  # no lossless master
            MP3_URL: redirect(storage_url),
            storage_url: file_response(audio.mp3, "audio/mpeg"),
        }
    )
    job_id = submit_import(h, import_options(fallback_url=MP3_URL, publish=False))
    status = h.pipeline.run(job_id)
    job = h.job(job_id)
    assert status == JobStatus.SUCCEEDED, (job.stage, job.error)
    assert job.state["fetch"]["format"] == "mp3"
    assert job.state["fetch"]["url"] == storage_url
    codes = {w["code"] for w in job.warnings}
    assert {"fetch_fallback", "fetch_format"} <= codes
    assert "tags_from_source" not in codes  # the MP3 carries its own tags
    with sessions() as s:
        track = s.get(Track, job.track_id)
        assert track is not None
        assert track.title == "MP3 Song"
        assert track.license_code == "CC BY-SA 3.0"
        release = s.get(Release, track.release_id)
        assert release is not None
        assert release.status == ReleaseStatus.DRAFT


def test_import_from_unlisted_host_fails_before_any_download(
    tmp_path: Path, sessions: sessionmaker[Session]
) -> None:
    h = Harness(tmp_path, sessions)
    seen: list[str] = []
    h.pipeline.http_transport = transport({}, seen)
    job_id = submit_import(h, import_options(download_url="https://evil.example/track.flac"))
    assert h.pipeline.run(job_id) == JobStatus.FAILED
    job = h.job(job_id)
    assert job.stage == "fetch"
    assert job.error is not None
    assert "не разрешено" in job.error
    assert seen == []
    assert job.track_id is None
    with sessions() as s:
        assert list(s.scalars(select(Track))) == []
