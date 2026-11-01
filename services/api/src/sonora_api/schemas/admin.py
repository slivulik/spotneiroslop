import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, field_validator

from sonora_api.models.enums import JobStatus, ReleaseStatus, UploadStage
from sonora_api.schemas.common import ApiModel

AUDIO_TYPES = {".flac": "audio/flac", ".mp3": "audio/mpeg"}
COVER_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def _extension(filename: str, allowed: dict[str, str]) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in allowed:
        raise ValueError(f"unsupported file type; allowed: {', '.join(sorted(allowed))}")
    return ext


class UploadFileIn(ApiModel):
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)


class AudioFileIn(UploadFileIn):
    @field_validator("filename")
    @classmethod
    def _audio(cls, value: str) -> str:
        _extension(value, AUDIO_TYPES)
        return value


class CoverFileIn(UploadFileIn):
    size_bytes: int = Field(gt=0, le=50 * 1024**2)

    @field_validator("filename")
    @classmethod
    def _cover(cls, value: str) -> str:
        _extension(value, COVER_TYPES)
        return value


class UploadOptions(ApiModel):
    publish: bool = Field(default=False, description="Publish the release as soon as processing succeeds")
    allow_duplicate: bool = Field(
        default=False, description="Process even if the same recording (hash or acoustic fingerprint) exists"
    )


class UploadCreateIn(ApiModel):
    source: AudioFileIn
    cover: CoverFileIn | None = Field(default=None, description="Used when the file has no embedded artwork")
    options: UploadOptions = Field(default_factory=UploadOptions)


class PresignedUploadOut(ApiModel):
    role: Literal["source", "cover"]
    url: str
    method: str
    headers: dict[str, str]


class UploadCreatedOut(ApiModel):
    job_id: uuid.UUID
    uploads: list[PresignedUploadOut]
    expires_in: int


class JobLogEntry(ApiModel):
    ts: datetime
    stage: str | None = None
    level: str
    message: str


class UploadJobOut(ApiModel):
    id: uuid.UUID
    status: JobStatus
    stage: str | None
    error: str | None
    files: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    options: dict[str, Any]
    attempts: int
    completed_stages: list[str]
    track_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class UploadJobDetailOut(UploadJobOut):
    logs: list[JobLogEntry]


class RetryIn(ApiModel):
    from_stage: UploadStage | None = Field(
        default=None,
        description="Re-run from this stage (later checkpoints are discarded); default: failed stage",
    )


class ReleasePatchIn(ApiModel):
    status: ReleaseStatus | None = None
    publish_at: datetime | None = None
