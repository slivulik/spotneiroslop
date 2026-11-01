import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from sonora_api.models.enums import Platform, UserRole
from sonora_api.schemas.common import ApiModel


class MeOut(ApiModel):
    id: uuid.UUID
    email: str
    email_verified: bool
    display_name: str
    avatar_url: str | None
    country: str | None
    language: str
    role: UserRole
    explicit_filter: bool
    onboarding_completed: bool
    has_password: bool
    created_at: datetime


class MePatch(ApiModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    language: str | None = Field(default=None, pattern=r"^[a-z]{2}(-[A-Z]{2})?$")
    explicit_filter: bool | None = None


class DeviceOut(ApiModel):
    id: uuid.UUID
    platform: Platform
    name: str
    model: str | None
    app_version: str | None
    offline_enabled: bool
    created_at: datetime
    last_seen_at: datetime
    current: bool = Field(description="True for the device that made this request")


class OnboardingIn(ApiModel):
    artist_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    genre_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------------------
# Settings (stored as JSONB, validated here; unknown keys rejected)
# ---------------------------------------------------------------------------


class StreamQuality(StrEnum):
    AUTO = "auto"
    HIRES = "hires"
    LOSSLESS = "lossless"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class Normalization(StrEnum):
    OFF = "off"
    TRACK = "track"
    ALBUM = "album"
    #: Album gain while a whole album plays in order, track gain otherwise.
    AUTO = "auto"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


EqBand = Annotated[float, Field(ge=-12, le=12)]


class AudioSettings(_Strict):
    quality_wifi: StreamQuality = StreamQuality.AUTO
    quality_cellular: StreamQuality = StreamQuality.NORMAL
    quality_download: StreamQuality = StreamQuality.HIGH
    data_saver: bool = False
    crossfade_seconds: int = Field(default=0, ge=0, le=12)
    wave_crossfade_seconds: int = Field(default=4, ge=0, le=12)
    normalization: Normalization = Normalization.AUTO
    gapless: bool = True


class EqualizerPreset(_Strict):
    name: str = Field(min_length=1, max_length=32)
    bands: list[EqBand] = Field(min_length=10, max_length=10)
    preamp: float = Field(default=0.0, ge=-12, le=12)


class EqualizerSettings(_Strict):
    enabled: bool = False
    preset: str = Field(default="flat", max_length=32)
    #: Gains in dB for 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz.
    bands: list[EqBand] = Field(default_factory=lambda: [0.0] * 10, min_length=10, max_length=10)
    preamp: float = Field(default=0.0, ge=-12, le=12)
    custom_presets: list[EqualizerPreset] = Field(default_factory=list, max_length=20)


class AppearanceSettings(_Strict):
    """Shared by web and Android so the look follows the account."""

    theme: Literal["dark", "light", "system"] = "dark"
    accent: Literal["default", "dynamic", "custom"] = "default"
    custom_accent: str = Field(default="#7352F5", pattern=r"^#[0-9A-Fa-f]{6}$")
    density: Literal["standard", "compact"] = "standard"
    motion: Literal["system", "full", "reduced"] = "system"
    progress_style: Literal["line", "wave"] = "line"
    preload_next: bool = True


class NotificationSettings(_Strict):
    new_releases: bool = True
    discover_weekly: bool = True
    playlist_updates: bool = True


class PrivacySettings(_Strict):
    private_session: bool = False
    share_listening_activity: bool = True


class TasteSettings(_Strict):
    genre_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class UserSettings(_Strict):
    appearance: AppearanceSettings = Field(default_factory=AppearanceSettings)
    audio: AudioSettings = Field(default_factory=AudioSettings)
    equalizer: EqualizerSettings = Field(default_factory=EqualizerSettings)
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    privacy: PrivacySettings = Field(default_factory=PrivacySettings)
    taste: TasteSettings = Field(default_factory=TasteSettings)
