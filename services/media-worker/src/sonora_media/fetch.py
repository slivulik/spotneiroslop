"""Downloads for imported tracks: the source audio (stage `fetch`) and the catalogue's cover.

Only HTTPS URLs on allow-listed hosts are fetched (Jamendo, Internet Archive and their
subdomains); redirects are followed by hand so every hop is checked against the same list.
Bodies are streamed to disk with a size cap and a deadline, and the result must really be FLAC
or MP3 (magic bytes) — an HTML error page or anything else never reaches the pipeline.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sonora_api.enrich.common import USER_AGENT
from sonora_api.services.sources.base import is_allowed_url

from sonora_media.errors import MediaError

MAX_REDIRECTS = 5
CHUNK = 1 << 16
MAX_COVER_BYTES = 20 * 1024**2
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
#: Content types a file server may legitimately use for audio downloads.
_BINARY_TYPES = frozenset(
    {
        "application/octet-stream",
        "binary/octet-stream",
        "application/flac",
        "application/x-flac",
        "application/x-download",
        "application/download",
        "application/force-download",
    }
)
_DISPOSITION_NAME = re.compile(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Downloaded:
    path: Path
    #: Where the bytes finally came from (after redirects).
    url: str
    size_bytes: int
    content_type: str
    #: "flac" or "mp3", from the file's own header.
    kind: str


def _host(url: str) -> str:
    try:
        return urlsplit(url).hostname or url
    except ValueError:
        return url


def _audio_type(content_type: str) -> bool:
    return not content_type or content_type.startswith("audio/") or content_type in _BINARY_TYPES


def _disposition_ok(header: str | None) -> bool:
    """A file name in Content-Disposition, if any, must be FLAC or MP3."""
    match = _DISPOSITION_NAME.search(header or "")
    return match is None or match.group(1).strip().lower().endswith((".flac", ".mp3"))


def _syncsafe(data: bytes) -> int:
    return (data[0] & 0x7F) << 21 | (data[1] & 0x7F) << 14 | (data[2] & 0x7F) << 7 | (data[3] & 0x7F)


def sniff(path: Path) -> str | None:
    """ "flac" / "mp3" from the first bytes after any ID3v2 tag; None for anything else."""
    with path.open("rb") as f:
        head = f.read(10)
        offset = 0
        if len(head) == 10 and head[:3] == b"ID3":
            offset = 10 + _syncsafe(head[6:10]) + (10 if head[5] & 0x10 else 0)
        f.seek(offset)
        start = f.read(4096).lstrip(b"\x00")[:4]  # some encoders pad after the tag
    if start == b"fLaC":
        return "flac"
    # MPEG audio frame sync (11 bits) + layer III.
    if len(start) >= 2 and start[0] == 0xFF and start[1] & 0xE0 == 0xE0 and (start[1] >> 1) & 0x3 == 0x1:
        return "mp3"
    return None


def _client(transport: httpx.BaseTransport | None) -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=False, transport=transport
    )


def _open(client: httpx.Client, url: str) -> tuple[httpx.Response, str]:
    """GET `url` following redirects by hand (each hop allow-listed). The caller closes it."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not is_allowed_url(current):
            raise MediaError(
                f"Скачивание с {_host(current)} не разрешено (только Jamendo и Internet Archive)"
            )
        response = client.send(client.build_request("GET", current), stream=True)
        if not response.is_redirect:
            return response, current
        location = response.headers.get("location", "")
        response.close()
        if not location:
            raise MediaError(f"{_host(current)} перенаправил без адреса")
        current = str(httpx.URL(current).join(location))
    raise MediaError("Слишком много перенаправлений при скачивании")


def _content_type(response: httpx.Response) -> str:
    return response.headers.get("content-type", "").split(";")[0].strip().lower()


def _stream_to(response: httpx.Response, part: Path, *, max_bytes: int, deadline: float, host: str) -> int:
    limit_mb = max_bytes // 1024**2
    if response.status_code != 200:
        raise MediaError(f"{host} ответил {response.status_code} — файл недоступен")
    content_type = _content_type(response)
    if not _audio_type(content_type) or not _disposition_ok(response.headers.get("content-disposition")):
        raise MediaError(f"{host} отдал не аудиофайл ({content_type or 'без типа'})")
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise MediaError(f"Файл больше {limit_mb} МБ — такой не импортируем")
    size = 0
    with part.open("wb") as out:
        for chunk in response.iter_bytes(CHUNK):
            size += len(chunk)
            if size > max_bytes:
                raise MediaError(f"Файл больше {limit_mb} МБ — такой не импортируем")
            if time.monotonic() > deadline:
                raise MediaError(f"Скачивание с {host} заняло слишком много времени")
            out.write(chunk)
    return size


def download_audio(
    url: str,
    dest_dir: Path,
    *,
    max_bytes: int,
    timeout_seconds: int,
    transport: httpx.BaseTransport | None = None,
) -> Downloaded:
    """Stream the file into `dest_dir/source.<kind>`; MediaError with a clear message otherwise."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    part = dest_dir / "download.part"
    deadline = time.monotonic() + timeout_seconds
    try:
        with _client(transport) as client:
            response, final_url = _open(client, url)
            try:
                size = _stream_to(
                    response, part, max_bytes=max_bytes, deadline=deadline, host=_host(final_url)
                )
                content_type = _content_type(response)
            finally:
                response.close()
    except httpx.HTTPError as exc:
        part.unlink(missing_ok=True)
        raise MediaError(f"Не удалось скачать файл с {_host(url)}: {exc}") from exc
    except MediaError:
        part.unlink(missing_ok=True)
        raise
    kind = sniff(part) if size else None
    if kind is None:
        part.unlink(missing_ok=True)
        raise MediaError(f"С {_host(final_url)} пришёл не FLAC и не MP3 — импорт отменён")
    path = part.rename(dest_dir / f"source.{kind}")
    return Downloaded(path=path, url=final_url, size_bytes=size, content_type=content_type, kind=kind)


def download_image(url: str, *, transport: httpx.BaseTransport | None = None) -> bytes | None:
    """The catalogue's cover (best effort: None on any problem; the pipeline then goes on)."""
    try:
        with _client(transport) as client:
            response, _ = _open(client, url)
            try:
                if response.status_code != 200 or not _content_type(response).startswith("image/"):
                    return None
                data = bytearray()
                for chunk in response.iter_bytes(CHUNK):
                    data += chunk
                    if len(data) > MAX_COVER_BYTES:
                        return None
                return bytes(data) or None
            finally:
                response.close()
    except (httpx.HTTPError, MediaError):
        return None
