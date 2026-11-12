from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from the environment (see `.env.example`)."""

    model_config = SettingsConfigDict(env_prefix="SONORA_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"
    log_json: bool = True

    database_url: str = "postgresql+asyncpg://sonora:sonora@localhost:5432/sonora"
    database_pool_size: int = 20
    database_max_overflow: int = 10
    database_statement_timeout_ms: int = 10_000
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: SecretStr = Field(min_length=32)
    jwt_issuer: str = "sonora"
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 30
    #: A refresh token presented again within this window after rotation is treated as a
    #: benign client race (two tabs refreshing at once) instead of token theft.
    refresh_reuse_grace_seconds: int = 30
    email_token_ttl_hours: int = 24
    password_reset_ttl_minutes: int = 60

    google_client_ids: Annotated[list[str], NoDecode] = []

    #: Object storage (SeaweedFS locally, R2 / B2 / Hetzner in production).
    s3_endpoint_url: str = "http://localhost:9000"
    #: Endpoint clients can reach for presigned uploads (may differ from the internal one).
    s3_public_endpoint_url: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = "sonora"
    s3_secret_key: SecretStr = SecretStr("sonora-secret")
    s3_uploads_bucket: str = "sonora-uploads"
    s3_media_bucket: str = "sonora-media"
    s3_public_bucket: str = "sonora-public"
    upload_url_ttl_seconds: int = 3600
    max_upload_bytes: int = 2 * 1024**3

    #: Dramatiq broker (Redis). Tests use an in-memory stub broker.
    queue_url: str = "redis://localhost:6379/1"

    web_base_url: str = "http://localhost:3000"
    media_base_url: str = "http://localhost:9000/sonora-public"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000", "http://localhost:3001"]

    email_backend: Literal["console", "smtp"] = "console"
    email_from: str = "Sonora <no-reply@sonora.local>"
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_starttls: bool = True

    #: Search and import from open catalogues (admin → «Открытые источники»). Only Creative Commons
    #: and public-domain recordings are ever listed or imported.
    sources_enabled: bool = True
    #: Jamendo API client id — free at https://devportal.jamendo.com. Empty: Jamendo is disabled.
    jamendo_client_id: str = ""

    rate_limit_enabled: bool = True
    #: Default budget per user (or per IP for anonymous requests).
    rate_limit_default_per_minute: int = 600
    rate_limit_auth_per_minute: int = 10

    @field_validator("google_client_ids", "cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
