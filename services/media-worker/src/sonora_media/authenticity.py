"""Stage 2: spot "lossless" files that were transcoded from lossy sources.

MP3/AAC encoders apply a steep low-pass (≈16 kHz at 128 kbit/s, ≈19–20 kHz at 320), which
shows up as a cliff in the spectrum: tens of dB lost within a few hundred Hz. Real recordings
roll off gently. We look for the steepest drop above 10 kHz; a cliff below 19 kHz on a
≥44.1 kHz lossless file is flagged for the admin, never rejected (some masters are genuinely
band-limited).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

from sonora_media.config import WorkerSettings
from sonora_media.pcm import decode_mono
from sonora_media.probe import ProbeResult

ANALYSIS_RATE = 44_100
SEGMENT_SECONDS = 60.0
FFT_SIZE = 4096
#: A cutoff below this on a ≥44.1 kHz lossless file suggests a lossy origin.
SUSPICIOUS_CUTOFF_HZ = 19_000.0
SEARCH_FROM_HZ = 10_000.0
#: Width of the windows compared on each side of a candidate cutoff.
HALF_SPAN_HZ = 500.0
#: Minimum level difference between the two windows to call it a cliff.
CLIFF_DB = 25.0


@dataclass(frozen=True, slots=True)
class AuthenticityResult:
    cutoff_hz: float
    suspicious: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _spectrum_db(samples: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray] | None:
    if samples.size < FFT_SIZE * 4:
        return None
    frames = samples[: samples.size // FFT_SIZE * FFT_SIZE].reshape(-1, FFT_SIZE)
    # Skip near-silent frames: they'd drag the average towards the noise floor.
    loud = frames[np.sqrt((frames**2).mean(axis=1)) > 1e-3]
    if loud.shape[0] < 4:
        return None
    window = np.hanning(FFT_SIZE).astype(np.float32)
    power = (np.abs(np.fft.rfft(loud * window, axis=1)) ** 2).mean(axis=0)
    db = np.convolve(10 * np.log10(power + 1e-20), np.ones(5) / 5, mode="same")
    return np.fft.rfftfreq(FFT_SIZE, 1 / sample_rate), db


def spectral_cutoff(samples: np.ndarray, sample_rate: int) -> float:
    """Frequency of the steepest spectral cliff above 10 kHz, or Nyquist if there is none."""
    nyquist = sample_rate / 2
    spectrum = _spectrum_db(samples, sample_rate)
    if spectrum is None:
        return nyquist
    freqs, db = spectrum
    span = max(1, int(HALF_SPAN_HZ / (freqs[1] - freqs[0])))
    cumulative = np.concatenate([[0.0], np.cumsum(db)])
    # For each bin i: mean of [i - span, i) minus mean of [i, i + span).
    idx = np.arange(span, db.size - span - 2)
    before = (cumulative[idx] - cumulative[idx - span]) / span
    after = (cumulative[idx + span] - cumulative[idx]) / span
    drop = before - after
    valid = freqs[idx] >= SEARCH_FROM_HZ
    if not valid.any():
        return nyquist
    best = int(np.argmax(np.where(valid, drop, -np.inf)))
    if drop[best] < CLIFF_DB:
        return nyquist
    cliff = idx[best]
    # The band above the cliff must stay low (not a notch with content returning above it).
    if db[cliff + 1 :].max() > before[best] - CLIFF_DB / 2:
        return nyquist
    return float(freqs[cliff])


def analyze(settings: WorkerSettings, path: Path, probe: ProbeResult) -> AuthenticityResult:
    nyquist = probe.sample_rate / 2
    if not probe.is_lossless or probe.sample_rate < ANALYSIS_RATE:
        return AuthenticityResult(cutoff_hz=nyquist, suspicious=False)
    duration_s = probe.duration_ms / 1000
    start = max(0.0, duration_s / 2 - SEGMENT_SECONDS / 2)
    samples = decode_mono(
        settings, path, sample_rate=ANALYSIS_RATE, start_s=start, duration_s=SEGMENT_SECONDS
    )
    cutoff = spectral_cutoff(samples, ANALYSIS_RATE)
    return AuthenticityResult(cutoff_hz=round(cutoff, 1), suspicious=cutoff < SUSPICIOUS_CUTOFF_HZ)
