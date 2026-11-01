from typing import Literal

from pydantic import Field

from sonora_api.models.enums import Quality
from sonora_api.schemas.common import ApiModel

WAVEFORM_BARS = 160

RequestedQuality = Literal["auto", "hires", "lossless", "high", "normal", "low"]


class RenditionOut(ApiModel):
    """What one quality of this track really is (from the encoded file, not the upload)."""

    quality: Quality
    codec: str = Field(description="flac | aac | he-aac | mp3")
    bitrate: int | None = Field(description="bits/s for lossy codecs; null for lossless")
    sample_rate: int
    bit_depth: int | None
    channels: int


class StreamOut(ApiModel):
    url: str = Field(description="HLS playlist path, relative to the API origin")
    quality: Literal["auto"] | Quality = Field(
        description="What `url` delivers after clamping to availability"
    )
    qualities: list[Quality] = Field(description="Renditions this track has, best first")
    renditions: list[RenditionOut] = Field(
        default_factory=list, description="Details of each quality, best first"
    )
    codec: str | None = Field(description="Codec of a fixed-quality stream; null for auto (ABR)")
    duration_ms: int
    track_gain: float | None = Field(description="dB to reach −14 LUFS, peak-safe")
    album_gain: float | None
    expires_in: int = Field(description="Seconds the playlist URL stays valid")
    waveform: list[int] | None = Field(
        default=None, description=f"Peaks 0–255 downsampled to {WAVEFORM_BARS} bars for the seek bar"
    )
