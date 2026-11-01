"""Stage 1: identify the file and make sure it decodes cleanly end to end."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from mutagen.flac import FLAC

from sonora_media.config import WorkerSettings
from sonora_media.errors import MediaError, ToolError, ToolMissingError
from sonora_media.tools import ffmpeg, ffmpeg_stderr, ffprobe_json

SUPPORTED = {"flac": "flac", "mp3": "mp3"}
MIN_DURATION_MS = 1_000
MAX_DURATION_MS = 4 * 3600 * 1000


@dataclass(frozen=True, slots=True)
class ProbeResult:
    codec: str  # "flac" | "mp3"
    duration_ms: int
    sample_rate: int
    channels: int
    #: Bits per sample for lossless sources; None for lossy.
    bit_depth: int | None
    bitrate: int | None
    #: Samples the decoder discards at the start (MP3 encoder delay from the LAME header).
    start_samples: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProbeResult:
        return cls(**data)

    @property
    def is_lossless(self) -> bool:
        return self.codec == "flac"


def probe(settings: WorkerSettings, path: Path) -> ProbeResult:
    try:
        info = ffprobe_json(settings, path)
    except ToolMissingError:
        raise
    except ToolError as exc:
        raise MediaError("Файл не читается как аудио") from exc

    audio = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not audio:
        raise MediaError("В файле нет аудиодорожки")
    stream = audio[0]
    codec = SUPPORTED.get(stream.get("codec_name", ""))
    if codec is None:
        raise MediaError(f"Неподдерживаемый кодек {stream.get('codec_name')!r}: загрузите FLAC или MP3")

    fmt = info.get("format", {})
    duration_s = float(stream.get("duration") or fmt.get("duration") or 0)
    duration_ms = round(duration_s * 1000)
    if not MIN_DURATION_MS <= duration_ms <= MAX_DURATION_MS:
        raise MediaError(f"Странная длительность: {duration_ms} мс")

    sample_rate = int(stream["sample_rate"])
    bit_depth = None
    if codec == "flac":
        bit_depth = int(stream.get("bits_per_raw_sample") or 0) or (
            24 if "32" in stream.get("sample_fmt", "") else 16
        )
    start_time = float(stream.get("start_time") or 0)
    bitrate = int(stream.get("bit_rate") or fmt.get("bit_rate") or 0) or None

    result = ProbeResult(
        codec=codec,
        duration_ms=duration_ms,
        sample_rate=sample_rate,
        channels=int(stream.get("channels") or 2),
        bit_depth=bit_depth,
        bitrate=bitrate,
        start_samples=round(start_time * sample_rate),
    )
    verify_decodes(settings, path, result)
    return result


_DECODE_PROBLEMS = re.compile(
    r"header missing|invalid (?:data|frame|new backstep)|error while decoding|overread|crc mismatch|"
    r"big_values too big|could not find codec parameters",
    re.IGNORECASE,
)


def verify_decodes(settings: WorkerSettings, path: Path, info: ProbeResult) -> None:
    """Decode the whole file and prove it's intact.

    ffmpeg resynchronises silently past damaged frames, so exit codes alone miss corruption.
    FLAC stores the MD5 of the original PCM in STREAMINFO: decoding must reproduce it exactly.
    MP3 has no such checksum, so decoder warnings are treated as damage.
    """
    try:
        if info.codec == "flac" and info.bit_depth in {16, 24}:
            expected = _flac_md5(path)
            if expected:
                out = ffmpeg(
                    settings, "-i", str(path), "-map", "0:a:0", "-c:a", f"pcm_s{info.bit_depth}le",
                    "-f", "hash", "-hash", "md5", "-",
                )  # fmt: skip
                if out.decode().strip().removeprefix("MD5=") != expected:
                    raise MediaError("Файл повреждён: звук не совпадает с контрольной суммой FLAC")
                return
        stderr = ffmpeg_stderr(settings, "-xerror", "-i", str(path), "-map", "0:a:0", "-f", "null", "-")
    except ToolMissingError:
        raise
    except ToolError as exc:
        raise MediaError(f"Файл повреждён и не декодируется: {exc}") from exc
    if problem := _DECODE_PROBLEMS.search(stderr):
        raise MediaError(f"Файл повреждён и не декодируется: {problem.group(0)}")


def _flac_md5(path: Path) -> str | None:
    signature = int(FLAC(path).info.md5_signature)
    return format(signature, "032x") if signature else None
