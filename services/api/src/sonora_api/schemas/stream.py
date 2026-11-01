from typing import Literal

from pydantic import Field

from sonora_api.models.enums import Quality
from sonora_api.schemas.common import ApiModel

WAVEFORM_BARS = 160

RequestedQuality = Literal["auto", "hires", "lossless", "high", "normal", "low"]


class StreamOut(ApiModel):
    url: str = Field(description="HLS playlist path, relative to the API origin")
    quality: Literal["auto"] | Quality = Field(
        description="What `url` delivers after clamping to availability"
    )
    qualities: list[Quality] = Field(description="Renditions this track has, best first")
    codec: str | None = Field(description="Codec of a fixed-quality stream; null for auto (ABR)")
    duration_ms: int
    track_gain: float | None = Field(description="dB to reach −14 LUFS, peak-safe")
    album_gain: float | None
    expires_in: int = Field(description="Seconds the playlist URL stays valid")
    waveform: list[int] | None = Field(
        default=None, description=f"Peaks 0–255 downsampled to {WAVEFORM_BARS} bars for the seek bar"
    )
