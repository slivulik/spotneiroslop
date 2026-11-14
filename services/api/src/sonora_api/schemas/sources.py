from typing import Annotated, Self

from pydantic import Field

from sonora_api.schemas.common import ApiModel
from sonora_api.services.sources.base import MAX_EXTERNAL_ID, SourceKey, SourceTrack


class SourceOut(ApiModel):
    """An open music catalogue the admin can import from."""

    key: SourceKey
    title: str
    description: str
    enabled: bool
    disabled_reason: str | None = Field(
        default=None, description="Why the source can't be used (e.g. no Jamendo key), in Russian"
    )


class SourceLicense(ApiModel):
    code: str = Field(description="Readable licence: «CC BY-SA 4.0», «CC0 1.0», «Public Domain Mark 1.0» …")
    url: str | None = Field(default=None, description="Licence deed")


class SourceTrackOut(ApiModel):
    source: SourceKey
    external_id: str = Field(description="Pass back to `/import`")
    title: str
    artist: str
    album: str | None
    duration_s: int | None
    license: SourceLicense
    artwork_url: str | None
    preview_url: str | None = Field(description="Directly playable stream for listening before import")
    page_url: str = Field(description="The recording's page at the source")
    format: str = Field(description="What will be downloaded: flac or mp3")
    already_imported: bool = Field(description="A track from this recording is already in the catalogue")

    @classmethod
    def from_track(cls, track: SourceTrack, *, already_imported: bool) -> Self:
        return cls(
            source=track.source,
            external_id=track.external_id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            duration_s=track.duration_s,
            license=SourceLicense(code=track.license.code, url=track.license.url),
            artwork_url=track.artwork_url,
            preview_url=track.preview_url,
            page_url=track.page_url,
            format=track.format,
            already_imported=already_imported,
        )


class SourceImportIn(ApiModel):
    external_ids: list[Annotated[str, Field(min_length=1, max_length=MAX_EXTERNAL_ID)]] = Field(
        min_length=1, max_length=50, description="Ids from the search results; resolved again on the server"
    )
    publish: bool = Field(default=False, description="Publish each release as soon as processing succeeds")
