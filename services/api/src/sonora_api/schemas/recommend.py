"""Recommendations: the wave, daily mixes, artist similarity and statistics."""

import uuid
from typing import Literal

from pydantic import Field

from sonora_api.schemas.catalog import Artwork, GenreRef, TrackOut
from sonora_api.schemas.common import ApiModel

#: «Любимое» / «Незнакомое» / «Популярное».
WaveCharacter = Literal["favorite", "discover", "popular"]
#: «Бодрое» / «Весёлое» / «Спокойное» / «Грустное».
WaveMood = Literal["energetic", "happy", "calm", "sad"]
#: «Русский» / «Иностранный» / «Без слов».
WaveLanguage = Literal["russian", "foreign", "instrumental"]
WaveAction = Literal["started", "finished", "skipped", "liked", "disliked"]


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


class WaveSettings(ApiModel):
    """How the listener tuned «Моя волна»; null means «any». Filters relax (language, then mood,
    then character) rather than leave the wave empty."""

    character: WaveCharacter | None = None
    mood: WaveMood | None = None
    language: WaveLanguage | None = None


class WaveStartIn(ApiModel):
    settings: WaveSettings = Field(default_factory=WaveSettings)
    #: Radio from a track (it is never served by the session itself) or from an artist.
    seed_track: uuid.UUID | None = None
    seed_artist: uuid.UUID | None = None
    limit: int = Field(default=20, ge=1, le=50)


class WaveSessionOut(ApiModel):
    session_id: uuid.UUID
    settings: WaveSettings
    tracks: list[TrackOut]


class WaveFeedbackIn(ApiModel):
    """What the listener did with a track of the session. `skipped` before 30 s pushes the artist
    and genres down for the rest of the session; `liked` also likes the track; `disliked` stores a
    «не нравится» (the client skips to the next track itself)."""

    track_id: uuid.UUID
    action: WaveAction
    played_ms: int | None = Field(default=None, ge=0, le=24 * 3600 * 1000)
