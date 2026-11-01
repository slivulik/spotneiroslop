"""Stage 4: content hash and acoustic fingerprint, for duplicate detection.

SHA-256 catches byte-identical re-uploads. The Chromaprint fingerprint catches the same
recording with different tags or a different encode: fingerprints are compared by bit error
rate over the best alignment, among tracks of similar duration.
"""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

import numpy as np
import numpy.typing as npt

from sonora_media.config import WorkerSettings
from sonora_media.tools import ffmpeg

FINGERPRINT_SECONDS = 120
MAX_OFFSET = 12  # fingerprint items (~1.5 s); re-encodes may shift slightly
DUPLICATE_SIMILARITY = 0.85
#: Candidates must be this close in duration to be compared at all.
DURATION_TOLERANCE_MS = 3_000

Fingerprint = npt.NDArray[np.uint32]


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def chromaprint(settings: WorkerSettings, path: Path) -> Fingerprint:
    raw = ffmpeg(
        settings, "-i", str(path), "-t", str(FINGERPRINT_SECONDS), "-map", "0:a:0",
        "-f", "chromaprint", "-fp_format", "raw", "-",
    )  # fmt: skip
    return np.frombuffer(raw, dtype="<u4").astype(np.uint32)


def encode(fp: Fingerprint) -> str:
    return base64.b64encode(fp.astype("<u4").tobytes()).decode()


def decode(value: str) -> Fingerprint:
    return np.frombuffer(base64.b64decode(value), dtype="<u4").astype(np.uint32)


def similarity(a: Fingerprint, b: Fingerprint) -> float:
    """1 − bit error rate at the best alignment within ±MAX_OFFSET items."""
    best = 0.0
    for offset in range(-MAX_OFFSET, MAX_OFFSET + 1):
        x, y = (a[offset:], b) if offset >= 0 else (a, b[-offset:])
        n = min(x.size, y.size)
        if n < 32:
            continue
        diff = np.bitwise_xor(x[:n], y[:n])
        bits = int(np.unpackbits(diff.view(np.uint8)).sum())
        best = max(best, 1 - bits / (n * 32))
    return best


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
