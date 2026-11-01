import json
from pathlib import Path

import httpx
import pytest

from sonora_uploader.cli import run
from sonora_uploader.client import SonoraAdmin, find_audio, find_cover


@pytest.fixture
def library(tmp_path: Path) -> Path:
    album = tmp_path / "Artist" / "Album"
    album.mkdir(parents=True)
    (album / "01 - One.flac").write_bytes(b"f" * 10)
    (album / "02 - Two.MP3").write_bytes(b"m" * 7)
    (album / "notes.txt").write_text("x")
    (album / "Folder.JPG").write_bytes(b"jpg")
    return tmp_path


def test_discovery(library: Path) -> None:
    files = find_audio(library)
    assert [f.name for f in files] == ["01 - One.flac", "02 - Two.MP3"]
    assert find_cover(files[0].parent) is not None


class FakeApi:
    def __init__(self) -> None:
        self.puts: dict[str, int] = {}
        self.jobs: dict[str, dict[str, object]] = {}
        self.polls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host == "s3.test":
            self.puts[path] = len(request.read())
            return httpx.Response(200)
        if path == "/v1/auth/login":
            return httpx.Response(200, json={"access_token": "tok", "user": {"role": "admin"}})
        assert request.headers["authorization"] == "Bearer tok"
        if path == "/v1/admin/uploads":
            body = json.loads(request.read())
            job_id = f"job-{len(self.jobs) + 1}"
            uploads = [
                {"role": "source", "url": f"https://s3.test/{job_id}/source", "method": "PUT", "headers": {}}
            ]
            if "cover" in body:
                uploads.append(
                    {
                        "role": "cover",
                        "url": f"https://s3.test/{job_id}/cover",
                        "method": "PUT",
                        "headers": {},
                    }
                )
            self.jobs[job_id] = {"status": "pending_upload", "options": body["options"]}
            return httpx.Response(201, json={"job_id": job_id, "uploads": uploads, "expires_in": 3600})
        if path.endswith("/complete"):
            job_id = path.split("/")[-2]
            self.jobs[job_id]["status"] = "queued"
            return httpx.Response(200, json={"id": job_id, "status": "queued"})
        job_id = path.split("/")[-1]
        self.polls += 1
        done = self.polls > 2
        status = ("failed" if job_id == "job-2" else "succeeded") if done else "running"
        return httpx.Response(
            200,
            json={
                "status": status,
                "error": "Duplicate of track x" if status == "failed" else None,
                "warnings": [{"code": "small_cover", "message": "Cover is small"}] if done else [],
            },
        )


def test_upload_and_wait(
    library: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    api = FakeApi()
    client = SonoraAdmin("https://api.test", transport=httpx.MockTransport(api.handler))
    monkeypatch.setenv("SONORA_PASSWORD", "secret")
    monkeypatch.setattr("sonora_uploader.client.time.sleep", lambda _: None)
    code = run([str(library), "--email", "a@b.c", "--publish", "--wait", "--parallel", "1"], client=client)

    assert code == 1  # one job failed
    assert api.puts == {"/job-1/source": 10, "/job-1/cover": 3, "/job-2/source": 7, "/job-2/cover": 3}
    assert all(job["options"] == {"publish": True, "allow_duplicate": False} for job in api.jobs.values())
    out = capsys.readouterr().out
    assert "[succeeded] 01 - One.flac" in out
    assert "[failed] 02 - Two.MP3  — Duplicate of track x" in out
    assert "! Cover is small" in out


def test_non_admin_is_rejected(library: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"access_token": "t", "user": {"role": "user"}})

    monkeypatch.setenv("SONORA_PASSWORD", "secret")
    client = SonoraAdmin("https://api.test", transport=httpx.MockTransport(handler))
    assert run([str(library), "--email", "a@b.c"], client=client) == 1
