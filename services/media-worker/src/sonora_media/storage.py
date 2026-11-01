"""Object storage for the worker. The public bucket (artwork) is anonymously readable; the
media bucket (audio, HLS, previews) is private and served through signed URLs."""

from __future__ import annotations

import mimetypes
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import boto3
from botocore.config import Config

from sonora_media.config import WorkerSettings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".m4s": "audio/mp4",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".avif": "image/avif",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
}
#: Every key embeds the job id or a content hash, so objects never change once written.
IMMUTABLE = "public, max-age=31536000, immutable"


def content_type(path: Path) -> str:
    return (
        CONTENT_TYPES.get(path.suffix.lower())
        or mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )


class MediaStorage(Protocol):
    def download(self, bucket: str, key: str, dest: Path) -> None: ...

    def upload_file(self, bucket: str, key: str, path: Path) -> None: ...


def upload_dir(storage: MediaStorage, bucket: str, prefix: str, directory: Path) -> list[str]:
    keys = []
    for path in sorted(p for p in directory.rglob("*") if p.is_file()):
        key = f"{prefix.rstrip('/')}/{path.relative_to(directory).as_posix()}"
        storage.upload_file(bucket, key, path)
        keys.append(key)
    return keys


class S3Storage:
    def __init__(self, settings: WorkerSettings) -> None:
        self._client: S3Client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key.get_secret_value(),
            config=Config(
                signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 5}
            ),
        )

    def download(self, bucket: str, key: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(bucket, key, str(dest))

    def upload_file(self, bucket: str, key: str, path: Path) -> None:
        self._client.upload_file(
            str(path), bucket, key, ExtraArgs={"ContentType": content_type(path), "CacheControl": IMMUTABLE}
        )


class LocalStorage:
    """Filesystem-backed storage for tests and local experiments: `<root>/<bucket>/<key>`."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, bucket: str, key: str) -> Path:
        return self.root / bucket / key

    def download(self, bucket: str, key: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.path(bucket, key), dest)

    def upload_file(self, bucket: str, key: str, path: Path) -> None:
        target = self.path(bucket, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
