import uuid
from datetime import date

from pydantic import Field

from sonora_api.models.enums import ArtistRole, LyricsType, ReleaseType
from sonora_api.schemas.common import ApiModel


class Palette(ApiModel):
    """Colours extracted from artwork, so clients can tint UI before the image loads."""

    dominant: str | None = None
    accent: str | None = None
    vibrant: str | None = None
    muted_dark: str | None = None
    text: str | None = Field(default=None, description="Text colour with WCAG AA contrast on `dominant`")


class Artwork(ApiModel):
    url_template: str = Field(
        description="Replace {size} with one of `sizes` and {format} with avif/webp/jpg"
    )
    sizes: list[int]
    blurhash: str | None = None
    palette: Palette | None = None


class ArtistRef(ApiModel):
    id: uuid.UUID
    name: str
    slug: str
    role: ArtistRole = ArtistRole.MAIN


class ReleaseRef(ApiModel):
    id: uuid.UUID
    title: str
    slug: str
    type: ReleaseType
    artwork: Artwork | None


class AudioBadges(ApiModel):
    lossless: bool
    hires: bool


class TrackOut(ApiModel):
    id: uuid.UUID
    title: str
    version: str | None
    duration_ms: int
    disc_number: int
    track_number: int
    is_explicit: bool
    artists: list[ArtistRef]
    release: ReleaseRef
    audio: AudioBadges
    has_lyrics: bool
    lyrics_type: LyricsType | None
    has_canvas: bool
    playable: bool = Field(
        description="False for guests and for explicit tracks when the explicit filter is on"
    )


class TrackList(ApiModel):
    items: list[TrackOut]


class GenreRef(ApiModel):
    id: uuid.UUID
    slug: str
    name: str


class ReleaseOut(ApiModel):
    id: uuid.UUID
    title: str
    slug: str
    type: ReleaseType
    release_date: date | None
    label: str | None
    upc: str | None
    is_explicit: bool
    artwork: Artwork | None
    artists: list[ArtistRef]
    total_duration_ms: int
    track_count: int
    tracks: list[TrackOut]
    #: Distinct genres of the release's tracks, most common first.
    genres: list[GenreRef] = Field(default_factory=list)


class ReleaseSummary(ApiModel):
    id: uuid.UUID
    title: str
    slug: str
    type: ReleaseType
    release_date: date | None
    is_explicit: bool
    artwork: Artwork | None
    artists: list[ArtistRef]
    track_count: int


class ArtistOut(ApiModel):
    id: uuid.UUID
    name: str
    slug: str
    bio: str | None
    artwork: Artwork | None
    header_video_url: str | None
    palette: Palette | None
    monthly_listeners: int
    verified: bool
    photo_credit: str | None = None
    bio_source: str | None = None


class GenreOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    parent_id: uuid.UUID | None
    color: str | None
    artwork: Artwork | None


class MoodOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    color: str | None
    artwork: Artwork | None


class GenreList(ApiModel):
    items: list[GenreOut]


class MoodList(ApiModel):
    items: list[MoodOut]
