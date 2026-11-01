"""Waveform peaks (0–255) for the progress bar and share previews."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from sonora_media.config import WorkerSettings
from sonora_media.pcm import Pcm, decode_mono

PEAKS = 800
RATE = 8_000


def peaks(samples: Pcm, count: int = PEAKS) -> list[int]:
    if samples.size == 0:
        return [0] * count
    buckets = np.array_split(np.abs(samples), count)
    values = np.array([b.max() if b.size else 0.0 for b in buckets], dtype=np.float32)
    top = float(values.max())
    if top <= 1e-6:
        return [0] * count
    return [int(v) for v in np.clip(np.round(values / top * 255), 0, 255)]


def compute(settings: WorkerSettings, path: Path) -> list[int]:
    return peaks(decode_mono(settings, path, sample_rate=RATE))
