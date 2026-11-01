"""Decode audio to mono float32 PCM via ffmpeg for analysis (spectrum, waveform, preview)."""

from pathlib import Path

import numpy as np
import numpy.typing as npt

from sonora_media.config import WorkerSettings
from sonora_media.tools import ffmpeg

Pcm = npt.NDArray[np.float32]


def decode_mono(
    settings: WorkerSettings,
    path: Path,
    *,
    sample_rate: int,
    start_s: float | None = None,
    duration_s: float | None = None,
) -> Pcm:
    args: list[str] = []
    if start_s is not None:
        args += ["-ss", f"{start_s:.3f}"]
    if duration_s is not None:
        args += ["-t", f"{duration_s:.3f}"]
    raw = ffmpeg(
        settings, *args, "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(sample_rate),
        "-f", "f32le", "-acodec", "pcm_f32le", "-",
    )  # fmt: skip
    return np.frombuffer(raw, dtype=np.float32)
