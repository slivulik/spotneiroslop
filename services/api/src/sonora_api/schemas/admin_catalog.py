import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field

from sonora_api.models.enums import (
    ArtistRole,
    CreditRole,
    LyricsType,
    Quality,
    ReleaseStatus,
    ReleaseType,
    TrackStatus,
)
from sonora_api.schemas.catalog import ArtistRef, Artwork, AudioBadges
from sonora_api.schemas.common import ApiModel
from sonora_api.schemas.media import ImageRef


class ReleaseLite(ApiModel):
    id: uuid.UUID
    title: str
    status: ReleaseStatus
    artwork: Artwork | None


class AdminTrackRow(ApiModel):
    id: uuid.UUID
    title: str
    version: str | None
    status: TrackStatus
    duration_ms: int
    disc_number: int
    track_number: int
    is_explicit: bool
    play_count: int
    artists: list[ArtistRef]
    release: ReleaseLite
    audio: AudioBadges
    has_lyrics: bool
    lyrics_type: LyricsType | None
    created_at: datetime


class CreditOut(ApiModel):
    name: str
    role: CreditRole


class FileOut(ApiModel):
    quality: Quality
    codec: str
    bitrate: int | None
    sample_rate: int
    bit_depth: int | None
    size_bytes: int


class LyricsAdminOut(ApiModel):
    type: LyricsType
    format: Literal["plain", "lrc"]
    text: str
    language: str | None


class LoudnessOut(ApiModel):
    lufs: float | None
    true_peak: float | None
    track_gain: float | None
    album_gain: float | None


class AdminTrackDetail(AdminTrackRow):
    isrc: str | None
    genres: list[str]
    credits: list[CreditOut]
    lyrics: LyricsAdminOut | None
    files: list[FileOut]
    loudness: LoudnessOut


class ArtistCreditIn(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    role: ArtistRole = ArtistRole.MAIN


class CreditIn(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    role: CreditRole


class AdminTrackPatch(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    version: str | None = Field(default=None, max_length=128)
    disc_number: int | None = Field(default=None, ge=1, le=99)
    track_number: int | None = Field(default=None, ge=1, le=999)
    is_explicit: bool | None = None
    isrc: str | None = Field(default=None, pattern=r"^[A-Z]{2}[A-Z0-9]{3}\d{7}$")
    status: Literal["ready", "hidden"] | None = None
    artists: list[ArtistCreditIn] | None = Field(default=None, min_length=1, max_length=20)
    genres: list[str] | None = Field(default=None, max_length=10)
    credits: list[CreditIn] | None = Field(default=None, max_length=50)


class LyricsIn(ApiModel):
    format: Literal["plain", "lrc"]
    text: str = Field(min_length=1, max_length=30_000)
    language: str | None = Field(default=None, pattern=r"^[a-z]{2}$")


class AdminReleaseRow(ApiModel):
    id: uuid.UUID
    title: str
    type: ReleaseType
    status: ReleaseStatus
    release_date: date | None
    publish_at: datetime | None
    artwork: Artwork | None
    artists: list[ArtistRef]
    track_count: int
    total_duration_ms: int
    created_at: datetime


class AdminReleaseDetail(AdminReleaseRow):
    label: str | None
    upc: str | None
    tracks: list[AdminTrackRow]


class AdminReleasePatch(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    type: ReleaseType | None = None
    release_date: date | None = None
    label: str | None = Field(default=None, max_length=255)
    upc: str | None = Field(default=None, pattern=r"^\d{12,14}$")
    status: ReleaseStatus | None = None
    publish_at: datetime | None = None
    cover: ImageRef | None = None
    artists: list[str] | None = Field(default=None, min_length=1, max_length=10)


class AdminArtistRow(ApiModel):
    id: uuid.UUID
    name: str
    slug: str
    artwork: Artwork | None
    verified: bool
    bio: str | None
    track_count: int
    release_count: int
    plays: int


class AdminArtistPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    bio: str | None = Field(default=None, max_length=5000)
    verified: bool | None = None
    photo: ImageRef | None = None


class SearchHit(ApiModel):
    """Item for admin pickers (home blocks, playlists)."""

    id: uuid.UUID
    kind: Literal["track", "release", "artist", "playlist", "genre"]
    title: str
    subtitle: str | None
    artwork: Artwork | None
