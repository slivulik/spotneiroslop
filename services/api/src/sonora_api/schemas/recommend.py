"""Recommendations: the wave, daily mixes, artist similarity and statistics."""

from sonora_api.schemas.catalog import Artwork, GenreRef, TrackOut
from sonora_api.schemas.common import ApiModel


class MixSummary(ApiModel):
    key: str
    title: str
    subtitle: str
    mosaic: list[Artwork]
    track_count: int


class MixOut(ApiModel):
    key: str
    title: str
    subtitle: str
    tracks: list[TrackOut]


class WeeklyPlays(ApiModel):
    week: str
    plays: int


class ArtistStatsOut(ApiModel):
    """Counted plays on SONORA (≥ 30 s or half the track); listeners are distinct accounts."""

    monthly_listeners: int
    plays_30d: int
    total_plays: int
    weekly: list[WeeklyPlays]
    first_release: str | None
    #: The artist's genres by how many of their tracks carry them.
    genres: list[GenreRef]
