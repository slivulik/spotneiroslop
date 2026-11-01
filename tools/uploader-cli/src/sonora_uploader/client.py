from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

AUDIO_EXTENSIONS = {".flac", ".mp3"}
COVER_NAMES = ("cover", "folder", "front", "artwork")
COVER_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
CHUNK = 1 << 20
TERMINAL = {"succeeded", "failed"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code = status, code


@dataclass
class UploadResult:
    path: Path
    job_id: str | None = None
    status: str = "pending"
    error: str | None = None
    warnings: list[dict[str, Any]] = field(default_factory=list)


def find_audio(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix.lower() in AUDIO_EXTENSIONS else []
    return sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS)


def find_cover(directory: Path) -> Path | None:
    files = {p.name.lower(): p for p in directory.iterdir() if p.is_file()}
    for name in COVER_NAMES:
        for ext in COVER_EXTENSIONS:
            if (match := files.get(name + ext)) is not None:
                return match
    return None


def _raise_for(response: httpx.Response) -> None:
    if response.is_success:
        return
    try:
        error = response.json()["error"]
        raise ApiError(response.status_code, error["code"], error["message"])
    except (ValueError, KeyError, TypeError):
        raise ApiError(response.status_code, "http_error", response.text[:200]) from None


def _stream(path: Path) -> Iterator[bytes]:
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            yield chunk


class SonoraAdmin:
    def __init__(
        self, base_url: str, *, transport: httpx.BaseTransport | None = None, timeout: float = 60
    ) -> None:
        self._api = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport)
        # Presigned URLs point at object storage, a different host; no API auth header there.
        # Timeouts apply per network operation (each chunk), so big files are fine but a stalled
        # connection still fails instead of hanging forever.
        self._storage = httpx.Client(timeout=httpx.Timeout(300, connect=30), transport=transport)
        self._token: str | None = None

    def close(self) -> None:
        self._api.close()
        self._storage.close()

    def login(self, email: str, password: str) -> None:
        response = self._api.post(
            "/v1/auth/login",
            json={
                "email": email,
                "password": password,
                "device": {"platform": "web", "name": "sonora-upload CLI"},
            },
        )
        _raise_for(response)
        body = response.json()
        if body["user"]["role"] != "admin":
            raise ApiError(403, "forbidden", "this account is not an administrator")
        self._token = body["access_token"]

    @property
    def _auth(self) -> dict[str, str]:
        if self._token is None:
            raise RuntimeError("call login() first")
        return {"Authorization": f"Bearer {self._token}"}

    def upload(self, path: Path, *, cover: Path | None, publish: bool, allow_duplicate: bool) -> str:
        body: dict[str, Any] = {
            "source": {"filename": path.name, "size_bytes": path.stat().st_size},
            "options": {"publish": publish, "allow_duplicate": allow_duplicate},
        }
        if cover is not None:
            body["cover"] = {"filename": cover.name, "size_bytes": cover.stat().st_size}
        created = self._api.post("/v1/admin/uploads", json=body, headers=self._auth)
        _raise_for(created)
        data = created.json()
        files = {"source": path, "cover": cover}
        for upload in data["uploads"]:
            local = files[upload["role"]]
            assert local is not None  # noqa: S101 - the API only presigns files we declared
            headers = {**upload["headers"], "Content-Length": str(local.stat().st_size)}
            put = self._storage.request(
                upload["method"], upload["url"], content=_stream(local), headers=headers
            )
            if not put.is_success:
                raise ApiError(put.status_code, "storage_upload_failed", put.text[:200])
        completed = self._api.post(f"/v1/admin/uploads/{data['job_id']}/complete", headers=self._auth)
        _raise_for(completed)
        return str(data["job_id"])

    def job(self, job_id: str) -> dict[str, Any]:
        response = self._api.get(f"/v1/admin/uploads/{job_id}", headers=self._auth)
        _raise_for(response)
        result: dict[str, Any] = response.json()
        return result

    def wait(
        self,
        results: list[UploadResult],
        *,
        poll_seconds: float = 3.0,
        timeout_seconds: float = 6 * 3600,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        deadline = time.monotonic() + timeout_seconds
        pending = [r for r in results if r.job_id and r.status not in TERMINAL]
        while pending and time.monotonic() < deadline:
            for result in pending:
                assert result.job_id is not None  # noqa: S101
                job = self.job(result.job_id)
                result.status, result.error, result.warnings = job["status"], job["error"], job["warnings"]
            pending = [r for r in pending if r.status not in TERMINAL]
            if pending:
                sleep(poll_seconds)
