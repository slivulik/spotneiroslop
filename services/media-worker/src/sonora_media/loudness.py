"""Stage 5: EBU R128 loudness and replay gain towards the target (−14 LUFS by default).

The source is never modified: clients apply `track_gain` / `album_gain`. Gain is capped so
the true peak after amplification stays below the ceiling (no clipping).
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sonora_media.config import WorkerSettings
from sonora_media.errors import ToolError
from sonora_media.tools import ffmpeg_stderr

_SUMMARY = re.compile(
    r"Integrated loudness:\s*I:\s*(?P<i>-?[\d.]+|-inf)\s*LUFS.*?"
    r"Loudness range:\s*LRA:\s*(?P<lra>-?[\d.]+)\s*LU.*?"
    r"True peak:\s*Peak:\s*(?P<peak>-?[\d.]+|-inf)\s*dBFS",
    re.S,
)
SILENCE_LUFS = -70.0


@dataclass(frozen=True, slots=True)
class Loudness:
    integrated_lufs: float
    lra: float
    true_peak_db: float
    track_gain: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _num(value: str) -> float:
    return -math.inf if value == "-inf" else float(value)


def parse_ebur128(stderr: str) -> tuple[float, float, float]:
    summaries = list(_SUMMARY.finditer(stderr))
    if not summaries:
        raise ToolError("ebur128 summary not found in ffmpeg output")
    m = summaries[-1]
    return _num(m["i"]), float(m["lra"]), _num(m["peak"])


def replay_gain(integrated_lufs: float, true_peak_db: float, *, target: float, ceiling: float) -> float:
    if integrated_lufs <= SILENCE_LUFS:
        return 0.0
    gain = target - integrated_lufs
    if math.isfinite(true_peak_db):
        gain = min(gain, ceiling - true_peak_db)
    return round(gain, 2)


def measure(settings: WorkerSettings, path: Path) -> Loudness:
    stderr = ffmpeg_stderr(
        settings, "-i", str(path), "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"
    )
    integrated, lra, peak = parse_ebur128(stderr)
    integrated = max(integrated, SILENCE_LUFS - 1) if not math.isfinite(integrated) else integrated
    return Loudness(
        integrated_lufs=round(integrated, 2),
        lra=round(lra, 2),
        true_peak_db=round(peak, 2) if math.isfinite(peak) else -99.0,
        track_gain=replay_gain(
            integrated, peak, target=settings.target_lufs, ceiling=settings.peak_ceiling_db
        ),
    )


def album_gain(tracks: list[tuple[float, float, int]], *, target: float, ceiling: float) -> float:
    """Album gain from (integrated LUFS, true peak dB, duration ms) of every track.

    Album loudness is the duration-weighted energy mean of track loudness; the cap uses the
    loudest true peak on the album, so album mode never clips any track.
    """
    if not tracks:
        return 0.0
    total = sum(d for _, _, d in tracks) or 1
    energy = sum(d * 10 ** (lufs / 10) for lufs, _, d in tracks) / total
    album_lufs = 10 * math.log10(energy) if energy > 0 else SILENCE_LUFS
    return replay_gain(album_lufs, max(p for _, p, _ in tracks), target=target, ceiling=ceiling)
