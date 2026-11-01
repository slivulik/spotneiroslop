from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    """Shares the `SONORA_` namespace (and `.env`) with the API so one file configures both."""

    model_config = SettingsConfigDict(env_prefix="SONORA_", env_file=".env", extra="ignore")

    env: str = "dev"
    log_level: str = "INFO"
    log_json: bool = True

    #: The API URL uses asyncpg; the worker is synchronous and swaps in psycopg.
    database_url: str = "postgresql+asyncpg://sonora:sonora@localhost:5432/sonora"
    queue_url: str = "redis://localhost:6379/1"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = "sonora"
    s3_secret_key: SecretStr = SecretStr("sonora-secret")
    s3_uploads_bucket: str = "sonora-uploads"
    #: Private: audio files, HLS, previews (served through signed URLs).
    s3_media_bucket: str = "sonora-media"
    #: Anonymously readable: artwork. Its public URL is the API's SONORA_MEDIA_BASE_URL.
    s3_public_bucket: str = "sonora-public"

    workdir: Path = Path("/tmp/sonora-media")  # noqa: S108 - per-job subdirectories, cleaned up
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    #: Hard limit for a single ffmpeg invocation (a 2 h hi-res file transcodes in minutes).
    ffmpeg_timeout_seconds: int = 1800
    target_lufs: float = -14.0
    #: Max true peak after applying gain, dBTP.
    peak_ceiling_db: float = -1.0
    hls_segment_seconds: int = 6

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+asyncpg", "+psycopg")


@lru_cache
def get_settings() -> WorkerSettings:
    return WorkerSettings()
