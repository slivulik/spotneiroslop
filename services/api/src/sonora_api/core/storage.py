"""Object storage access for the API: presigned uploads and existence checks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import anyio.to_thread
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from sonora_api.core.config import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


@dataclass(frozen=True, slots=True)
class PresignedUpload:
    url: str
    method: str
    headers: dict[str, str]


class Storage(Protocol):
    def presign_upload(self, bucket: str, key: str, content_type: str) -> PresignedUpload: ...

    async def object_size(self, bucket: str, key: str) -> int | None: ...


def _client(settings: Settings, endpoint: str) -> S3Client:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key.get_secret_value(),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )


class ObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._internal = _client(settings, settings.s3_endpoint_url)
        # Presigned URLs embed the host, so they must be signed for the client-facing endpoint.
        self._public = _client(settings, settings.s3_public_endpoint_url)

    def presign_upload(self, bucket: str, key: str, content_type: str) -> PresignedUpload:
        url = self._public.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=self._settings.upload_url_ttl_seconds,
        )
        return PresignedUpload(url=url, method="PUT", headers={"Content-Type": content_type})

    async def object_size(self, bucket: str, key: str) -> int | None:
        """Size of an uploaded object, or None when it doesn't exist."""

        def head() -> int | None:
            try:
                return self._internal.head_object(Bucket=bucket, Key=key)["ContentLength"]
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                    return None
                raise

        return await anyio.to_thread.run_sync(head)
