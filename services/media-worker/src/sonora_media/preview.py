"""30-second preview from the most energetic part of the track (guests, share pages)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from sonora_media.config import WorkerSettings
from sonora_media.pcm import Pcm, decode_mono
from sonora_media.tools import ffmpeg

PREVIEW_MS = 30_000
RATE = 11_025
FADE_S = 1.0


def best_window_start_ms(samples: Pcm, rate: int, duration_ms: int, window_ms: int = PREVIEW_MS) -> int:
    """Start of the window with the highest mean RMS, skipping the intro (first 10 %) and outro."""
    if duration_ms <= window_ms:
        return 0
    second = rate
    seconds = samples.size // second
    if seconds == 0:
        return 0
    rms = np.sqrt((samples[: seconds * second].reshape(seconds, second) ** 2).mean(axis=1))
    window = window_ms // 1000
    if seconds <= window:
        return 0
    cumulative = np.concatenate([[0.0], np.cumsum(rms)])
    energy = cumulative[window:] - cumulative[:-window]  # energy[i] = window starting at second i
    earliest = int(seconds * 0.10)
    latest = max(earliest, seconds - window - int(seconds * 0.05))
    candidates = energy[earliest : latest + 1]
    if candidates.size == 0:
        return 0
    return (earliest + int(np.argmax(candidates))) * 1000


def render(settings: WorkerSettings, source: Path, duration_ms: int, out: Path) -> int:
    samples = decode_mono(settings, source, sample_rate=RATE)
    start_ms = best_window_start_ms(samples, RATE, duration_ms)
    length_s = min(PREVIEW_MS, duration_ms) / 1000
    fade_out = max(0.0, length_s - FADE_S)
    ffmpeg(
        settings, "-ss", f"{start_ms / 1000:.3f}", "-t", f"{length_s:.3f}", "-i", str(source),
        "-map", "0:a:0", "-map_metadata", "-1",
        "-af", f"afade=t=in:d={FADE_S},afade=t=out:st={fade_out:.3f}:d={FADE_S}",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", str(out),
    )  # fmt: skip
    return start_ms
