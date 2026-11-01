import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from sonora_api.schemas.common import ApiModel


class PlayEvent(ApiModel):
    event_id: uuid.UUID = Field(description="Client-generated; re-sent events are ignored")
    type: Literal["play_start", "play_end"]
    track_id: uuid.UUID
    ms_played: int = Field(default=0, ge=0, le=24 * 3600 * 1000)
    at: datetime | None = None
    context_type: Literal["release", "artist", "playlist", "tracks", "home", "genre"] | None = None
    context_id: uuid.UUID | None = None


class EventsIn(ApiModel):
    events: list[PlayEvent] = Field(min_length=1, max_length=500)


class EventsOut(ApiModel):
    accepted: int
    duplicates: int
    counted_plays: int
