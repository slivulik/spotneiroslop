"""Home page blocks, editorial playlists and genres: public shapes and admin inputs."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from sonora_api.models.enums import HomeSectionType, PlaylistType
from sonora_api.schemas.catalog import Artwork, GenreOut, ReleaseSummary, TrackOut
from sonora_api.schemas.common import ApiModel
from sonora_api.schemas.media import ImageRef

SectionSource = Literal["manual", "new", "popular", "hires", "all", "recent"]
SectionStyle = Literal["shelf", "stories", "grid", "list", "circles", "tiles", "banner"]

#: Which automatic sources each block type understands.
ALLOWED_SOURCES: dict[HomeSectionType, set[str]] = {
    HomeSectionType.HERO: {"manual"},
    HomeSectionType.RELEASES: {"manual", "new", "popular", "hires"},
    HomeSectionType.TRACKS: {"manual", "new", "popular", "recent"},
    HomeSectionType.PLAYLISTS: {"manual", "all"},
    HomeSectionType.ARTISTS: {"manual", "popular"},
    HomeSectionType.GENRES: {"manual", "all"},
}


class HomeLink(ApiModel):
    type: Literal["release", "playlist", "artist", "genre", "url"]
    id: str | None = Field(default=None, max_length=128, description="Entity id (or genre slug)")
    url: str | None = Field(default=None, max_length=512, pattern=r"^(https?://|/)")

    @model_validator(mode="after")
    def _target(self) -> "HomeLink":
        if self.type == "url" and not self.url:
            raise ValueError("url is required for type=url")
        if self.type != "url" and not self.id:
            raise ValueError("id is required")
        return self


class SectionConfig(ApiModel):
    source: SectionSource = "manual"
    ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    limit: int = Field(default=12, ge=1, le=50)
    style: SectionStyle = "shelf"
    #: Hero banner only.
    image: ImageRef | None = None
    link: HomeLink | None = None
    cta_label: str | None = Field(default=None, max_length=40)


class HomeSectionIn(ApiModel):
    type: HomeSectionType
    title: str = Field(min_length=1, max_length=128)
    subtitle: str | None = Field(default=None, max_length=256)
    is_active: bool = True
    config: SectionConfig = Field(default_factory=SectionConfig)

    @model_validator(mode="after")
    def _consistent(self) -> "HomeSectionIn":
        if self.config.source not in ALLOWED_SOURCES[self.type]:
            raise ValueError(f"source '{self.config.source}' is not available for {self.type.value} blocks")
        if self.type == HomeSectionType.HERO and self.config.image is None:
            raise ValueError("hero blocks need an image")
        if self.config.source == "manual" and self.type != HomeSectionType.HERO and not self.config.ids:
            raise ValueError("pick at least one item, or choose an automatic source")
        return self


class HomeSectionPatch(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    subtitle: str | None = Field(default=None, max_length=256)
    is_active: bool | None = None
    config: SectionConfig | None = None


class HomeSectionAdminOut(ApiModel):
    id: uuid.UUID
    type: HomeSectionType
    title: str
    subtitle: str | None
    position: int
    is_active: bool
    config: SectionConfig
    updated_at: datetime


class ReorderIn(ApiModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


# --- public --------------------------------------------------------------------------------


class PlaylistSummary(ApiModel):
    id: uuid.UUID
    title: str
    description: str | None
    type: PlaylistType
    artwork: Artwork | None
    #: Up to four release covers for a collage when the playlist has no own cover.
    mosaic: list[Artwork]
    track_count: int
    owner_name: str | None


class PlaylistOut(PlaylistSummary):
    total_duration_ms: int
    updated_at: datetime
    tracks: list[TrackOut]


class ArtistSummary(ApiModel):
    id: uuid.UUID
    name: str
    slug: str
    artwork: Artwork | None
    verified: bool


class HeroOut(ApiModel):
    artwork: Artwork
    link: HomeLink | None
    cta_label: str | None


class HomeBlock(ApiModel):
    id: str
    type: HomeSectionType
    style: SectionStyle
    title: str
    subtitle: str | None
    hero: HeroOut | None = None
    releases: list[ReleaseSummary] = Field(default_factory=list)
    tracks: list[TrackOut] = Field(default_factory=list)
    playlists: list[PlaylistSummary] = Field(default_factory=list)
    artists: list[ArtistSummary] = Field(default_factory=list)
    genres: list[GenreOut] = Field(default_factory=list)


class HomeOut(ApiModel):
    sections: list[HomeBlock]
    #: True when the page is the built-in default (no blocks configured in the admin).
    is_default: bool


class SearchOut(ApiModel):
    tracks: list[TrackOut]
    releases: list[ReleaseSummary]
    artists: list[ArtistSummary]
    playlists: list[PlaylistSummary]
    genres: list[GenreOut] = Field(default_factory=list)


class GenreDetail(ApiModel):
    genre: GenreOut
    description: str | None
    releases: list[ReleaseSummary]
    tracks: list[TrackOut]


class PlatformPublic(ApiModel):
    registration_open: bool
    guest_previews: bool
    announcement: dict[str, object] | None
    maintenance: dict[str, object] | None


# --- admin inputs ----------------------------------------------------------------------------


class PlaylistAdminIn(ApiModel):
    title: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    is_public: bool = True
    cover: ImageRef | None = None


class PlaylistAdminPatch(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    is_public: bool | None = None
    cover: ImageRef | None = None


class PlaylistTracksIn(ApiModel):
    track_ids: list[uuid.UUID] = Field(
        max_length=2000, description="Full ordered list; replaces the current one"
    )


class GenreAdminIn(ApiModel):
    name: str = Field(min_length=1, max_length=128)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    description: str | None = Field(default=None, max_length=2000)
    position: int | None = Field(default=None, ge=0, le=10_000)
    cover: ImageRef | None = None


class GenreAdminPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    description: str | None = Field(default=None, max_length=2000)
    position: int | None = Field(default=None, ge=0, le=10_000)
    cover: ImageRef | None = None
