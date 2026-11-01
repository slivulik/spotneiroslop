"""Replay-gain math (EBU R128 based), shared by the media worker and admin edits."""

from __future__ import annotations

import math

SILENCE_LUFS = -70.0
TARGET_LUFS = -14.0
PEAK_CEILING_DB = -1.0


def replay_gain(integrated_lufs: float, true_peak_db: float, *, target: float, ceiling: float) -> float:
    if integrated_lufs <= SILENCE_LUFS:
        return 0.0
    gain = target - integrated_lufs
    if math.isfinite(true_peak_db):
        gain = min(gain, ceiling - true_peak_db)
    return round(gain, 2)


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
