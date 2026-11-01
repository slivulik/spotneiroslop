import uuid
from datetime import datetime

from pydantic import Field

from sonora_api.models.enums import UserRole
from sonora_api.schemas.catalog import TrackOut
from sonora_api.schemas.common import ApiModel


class AdminUserRow(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: UserRole
    email_verified: bool
    created_at: datetime
    blocked_at: datetime | None
    block_reason: str | None
    devices: int
    last_seen_at: datetime | None
    plays: int


class AdminUserPatch(ApiModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    role: UserRole | None = None
    blocked: bool | None = None
    block_reason: str | None = Field(default=None, max_length=256)


class StatsOut(ApiModel):
    users: int
    users_today: int
    blocked_users: int
    tracks_ready: int
    tracks_processing: int
    releases_published: int
    releases_draft: int
    artists: int
    playlists: int
    plays_today: int
    plays_7d: int
    listening_now: int
    jobs: dict[str, int]


class ListeningNow(ApiModel):
    user_id: uuid.UUID
    display_name: str
    track: TrackOut
    started_at: datetime


class TopTrack(ApiModel):
    track: TrackOut
    plays: int


class DailyPlays(ApiModel):
    day: str
    plays: int
    listeners: int


class StreamingOut(ApiModel):
    listening_now: list[ListeningNow]
    plays_today: int
    plays_7d: int
    listeners_7d: int
    daily: list[DailyPlays]
    top_tracks: list[TopTrack]
