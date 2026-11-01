"""Personal library: likes, follows, the user's own playlists, histories."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from sonora_api.schemas.catalog import TrackOut
from sonora_api.schemas.common import ApiModel
from sonora_api.schemas.media import ImageRef

LikeKind = Literal["tracks", "releases", "artists", "playlists"]


class LibraryIds(ApiModel):
    """Everything the viewer has saved, as ids — enough to render every heart in the UI."""

    tracks: list[uuid.UUID]
    releases: list[uuid.UUID]
    artists: list[uuid.UUID]
    playlists: list[uuid.UUID]


class UserPlaylistIn(ApiModel):
    title: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    is_public: bool = False
    track_ids: list[uuid.UUID] = Field(default_factory=list, max_length=1000)


class UserPlaylistPatch(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    is_public: bool | None = None
    cover: ImageRef | None = None


class PlaylistTracksIn(ApiModel):
    track_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class PlaylistOrderIn(ApiModel):
    track_ids: list[uuid.UUID] = Field(max_length=5000)


class HistoryEntry(ApiModel):
    played_at: datetime
    ms_played: int
    track: TrackOut


class HistoryOut(ApiModel):
    items: list[HistoryEntry]


class SearchQueryIn(ApiModel):
    query: str = Field(min_length=1, max_length=100)


class SearchHistoryOut(ApiModel):
    queries: list[str]


class PopularSearchesOut(ApiModel):
    queries: list[str]
    #: "searches" when built from what people actually searched, "plays" when from listening.
    source: Literal["searches", "plays"]
