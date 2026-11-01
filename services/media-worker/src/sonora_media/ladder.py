"""Quality ladder: which renditions to produce for a source. Pure; never upscales.

| Source        | hires            | lossless           | high              | normal  | low                  |
|---------------|------------------|--------------------|-------------------|---------|----------------------|
| FLAC 24/≥48k  | FLAC 24 (source) | FLAC 16/44.1 soxr  | AAC 256           | AAC 160 | HE-AAC 64 / AAC 96   |
| FLAC 24/44.1  | —                | FLAC 16/44.1 dither| AAC 256           | AAC 160 | HE-AAC 64 / AAC 96   |
| FLAC 16       | —                | FLAC 16 (source)   | AAC 256           | AAC 160 | HE-AAC 64 / AAC 96   |
| MP3           | —                | —                  | MP3 (source copy) | AAC 160*| HE-AAC 64 / AAC 96*  |

* only when the MP3 bitrate is higher than the target. HE-AAC needs libfdk_aac; without it the
low tier is AAC-LC 96 kbit/s, which every client decodes.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from sonora_api.models.enums import Quality

from sonora_media.probe import ProbeResult

HIRES_MIN_BIT_DEPTH = 24
HIRES_MIN_SAMPLE_RATE = 48_000
CD_RATE = 44_100

HLS_CODECS = {"flac": "fLaC", "aac": "mp4a.40.2", "he-aac": "mp4a.40.5", "mp3": "mp4a.40.34"}
EXTENSIONS = {"flac": "flac", "aac": "m4a", "he-aac": "m4a", "mp3": "mp3"}
#: Lossy tiers make up the ABR ("Auto") master playlist.
AUTO_QUALITIES = (Quality.LOW, Quality.NORMAL, Quality.HIGH)


@dataclass(frozen=True, slots=True)
class Rendition:
    quality: Quality
    codec: str  # flac | aac | he-aac | mp3
    sample_rate: int
    bit_depth: int | None = None
    bitrate: int | None = None  # bits/s, lossy only
    #: Use the source bytes as-is (MP3 "high"): no generation loss.
    copy_source: bool = False
    #: Resample with soxr (and dither when reducing bit depth).
    resample: bool = False

    @property
    def extension(self) -> str:
        return EXTENSIONS[self.codec]

    @property
    def hls_codec(self) -> str:
        return HLS_CODECS[self.codec]

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["quality"] = self.quality.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Rendition:
        return cls(**{**data, "quality": Quality(data["quality"])})


def aac_rate(source_rate: int) -> int:
    """AAC at 48 kHz for the 48 kHz family, 44.1 kHz otherwise (no point above that)."""
    return 48_000 if source_rate % 48_000 == 0 else CD_RATE


def plan_ladder(probe: ProbeResult, *, has_fdk_aac: bool) -> list[Rendition]:
    renditions: list[Rendition] = []
    rate = aac_rate(probe.sample_rate)
    needs_resample = probe.sample_rate not in {CD_RATE, 48_000}
    low = (
        Rendition(Quality.LOW, "he-aac", rate, bitrate=64_000, resample=needs_resample)
        if has_fdk_aac
        else Rendition(Quality.LOW, "aac", rate, bitrate=96_000, resample=needs_resample)
    )

    if probe.is_lossless:
        depth = probe.bit_depth or 16
        if depth >= HIRES_MIN_BIT_DEPTH and probe.sample_rate >= HIRES_MIN_SAMPLE_RATE:
            renditions.append(Rendition(Quality.HIRES, "flac", probe.sample_rate, bit_depth=24))
        if depth > 16 or probe.sample_rate > 48_000:
            renditions.append(Rendition(Quality.LOSSLESS, "flac", CD_RATE, bit_depth=16, resample=True))
        else:
            renditions.append(Rendition(Quality.LOSSLESS, "flac", probe.sample_rate, bit_depth=16))
        renditions += [
            Rendition(Quality.HIGH, "aac", rate, bitrate=256_000, resample=needs_resample),
            Rendition(Quality.NORMAL, "aac", rate, bitrate=160_000, resample=needs_resample),
            low,
        ]
        return renditions

    source_bitrate = probe.bitrate or 320_000
    renditions.append(
        Rendition(Quality.HIGH, "mp3", probe.sample_rate, bitrate=source_bitrate, copy_source=True)
    )
    if source_bitrate > 160_000:
        renditions.append(Rendition(Quality.NORMAL, "aac", rate, bitrate=160_000, resample=needs_resample))
    if source_bitrate > (low.bitrate or 0):
        renditions.append(low)
    return renditions
