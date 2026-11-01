"""Stage 6: encode every rendition and package it as HLS (fMP4 segments).

Each rendition yields a whole file (offline downloads) and an HLS media playlist built from
that file with stream copy, so both carry identical audio. Gapless metadata (encoder delay /
padding) is recorded per file; AAC in MP4 also carries an edit list that trims priming samples.
"""

from __future__ import annotations

import math
import re
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sonora_media.config import WorkerSettings
from sonora_media.fingerprint import sha256_file
from sonora_media.ladder import AUTO_QUALITIES, Rendition
from sonora_media.mp4 import set_edit_list
from sonora_media.probe import ProbeResult
from sonora_media.tools import ffmpeg, ffprobe_json

AAC_FRAME = 1024
#: Priming samples of ffmpeg's native AAC encoder (and libfdk-aac LC).
AAC_PRIMING = 1024
SOXR = "aresample=resampler=soxr:precision=28"
_EXTINF = re.compile(r"#EXTINF:([\d.]+)")


@dataclass(frozen=True, slots=True)
class EncodedRendition:
    rendition: Rendition
    file: Path
    size_bytes: int
    sha256: str
    encoder_delay: int
    encoder_padding: int
    hls_dir: Path
    #: Peak and average segment bitrate (bits/s) for the master playlist.
    peak_bitrate: int
    average_bitrate: int

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["rendition"] = self.rendition.to_dict()
        data["file"] = str(self.file)
        data["hls_dir"] = str(self.hls_dir)
        return data


def _encode_args(r: Rendition, probe: ProbeResult) -> list[str]:
    if r.codec == "flac":
        args = ["-c:a", "flac", "-compression_level", "8"]
        if r.bit_depth == 24:
            return [*args, "-sample_fmt", "s32", "-bits_per_raw_sample", "24"]
        if r.resample or (probe.bit_depth or 16) > 16:
            # 24 → 16 bit: soxr resampling with triangular dither.
            return [
                "-af",
                f"{SOXR}:osf=s16:dither_method=triangular",
                "-ar",
                str(r.sample_rate),
                *args,
                "-sample_fmt",
                "s16",
            ]
        return [*args, "-sample_fmt", "s16"]
    filters = ["-af", SOXR] if r.resample else []
    if r.codec == "he-aac":
        return [
            *filters,
            "-ar",
            str(r.sample_rate),
            "-c:a",
            "libfdk_aac",
            "-profile:a",
            "aac_he",
            "-b:a",
            str(r.bitrate),
        ]
    return [
        *filters,
        "-ar",
        str(r.sample_rate),
        "-c:a",
        "aac",
        "-b:a",
        str(r.bitrate),
        "-movflags",
        "+faststart",
    ]


def mp3_gapless(path: Path) -> tuple[int, int]:
    """Encoder delay and padding from the LAME header (0, 0 when absent)."""
    head = path.read_bytes()[: 64 * 1024]
    pos = head.find(b"LAME")
    if pos < 0 or pos + 24 > len(head):
        return 0, 0
    b = head[pos + 21 : pos + 24]
    return (b[0] << 4) | (b[1] >> 4), ((b[1] & 0x0F) << 8) | b[2]


def _aac_gapless(
    settings: WorkerSettings, file: Path, source_duration_ms: int, sample_rate: int
) -> tuple[int, int]:
    stream = next(s for s in ffprobe_json(settings, file)["streams"] if s.get("codec_type") == "audio")
    frames = int(stream.get("nb_frames") or 0)
    if not frames:
        return AAC_PRIMING, 0
    samples = round(source_duration_ms * sample_rate / 1000)
    return AAC_PRIMING, max(0, frames * AAC_FRAME - AAC_PRIMING - samples)


def encode(
    settings: WorkerSettings, source: Path, probe: ProbeResult, r: Rendition, out_dir: Path
) -> EncodedRendition:
    out_dir.mkdir(parents=True, exist_ok=True)
    file = out_dir / f"{r.quality.value}.{r.extension}"
    if r.copy_source:
        shutil.copyfile(source, file)
        delay, padding = mp3_gapless(file)
    else:
        ffmpeg(
            settings,
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-map_metadata",
            "-1",
            *_encode_args(r, probe),
            str(file),
        )
        delay, padding = (
            _aac_gapless(settings, file, probe.duration_ms, r.sample_rate)
            if r.codec in {"aac", "he-aac"}
            else (0, 0)
        )
    hls_dir = out_dir / "hls" / r.quality.value
    peak, average = package_hls(settings, file, hls_dir)
    if r.codec in {"aac", "he-aac"}:
        # Restore the priming/padding trim that the fMP4 muxer drops (gapless albums).
        set_edit_list(hls_dir / "init.mp4", priming_samples=delay, duration_s=probe.duration_ms / 1000)
    return EncodedRendition(
        rendition=r,
        file=file,
        size_bytes=file.stat().st_size,
        sha256=sha256_file(file),
        encoder_delay=delay,
        encoder_padding=padding,
        hls_dir=hls_dir,
        peak_bitrate=peak,
        average_bitrate=average,
    )


def package_hls(settings: WorkerSettings, file: Path, hls_dir: Path) -> tuple[int, int]:
    """Segment `file` into fMP4 HLS with stream copy; returns (peak, average) bitrate."""
    hls_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg(
        settings,
        "-i", str(file), "-map", "0:a:0", "-c", "copy", "-strict", "experimental",
        "-f", "hls", "-hls_time", str(settings.hls_segment_seconds), "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
        "-hls_segment_filename", str(hls_dir / "seg_%05d.m4s"),
        str(hls_dir / "playlist.m3u8"),
    )  # fmt: skip
    return segment_bitrates(hls_dir)


def segment_bitrates(hls_dir: Path) -> tuple[int, int]:
    playlist = (hls_dir / "playlist.m3u8").read_text()
    durations = [float(d) for d in _EXTINF.findall(playlist)]
    segments = sorted(hls_dir.glob("seg_*.m4s"))
    if not durations or len(durations) != len(segments):
        return 0, 0
    rates = [seg.stat().st_size * 8 / max(dur, 0.001) for seg, dur in zip(segments, durations, strict=True)]
    total_bits = sum(seg.stat().st_size * 8 for seg in segments)
    return math.ceil(max(rates)), math.ceil(total_bits / sum(durations))


def master_playlist(encoded: list[EncodedRendition], qualities: tuple[Any, ...] = AUTO_QUALITIES) -> str:
    """ABR master for "Auto": lossy tiers only, `normal` first so playback starts mid-ladder.

    Lossless and Hi-Res are explicit choices served via their own media playlists.
    """
    order = {q: i for i, q in enumerate((qualities[1], qualities[0], *qualities[2:]))}
    variants = sorted(
        (e for e in encoded if e.rendition.quality in order), key=lambda e: order[e.rendition.quality]
    )
    lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
    for e in variants:
        lines.append(
            f'#EXT-X-STREAM-INF:BANDWIDTH={e.peak_bitrate},AVERAGE-BANDWIDTH={e.average_bitrate},CODECS="{e.rendition.hls_codec}"'
        )
        lines.append(f"{e.rendition.quality.value}/playlist.m3u8")
    return "\n".join(lines) + "\n"
