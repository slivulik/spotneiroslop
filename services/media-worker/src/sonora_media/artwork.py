"""Stage: cover renditions. The image code lives in `sonora_api.media.images` (shared with the
admin image uploads); this module adapts its errors to the pipeline."""

from __future__ import annotations

from pathlib import Path

from sonora_api.media.images import (
    FORMATS,
    MIN_RECOMMENDED,
    SIZES,
    WCAG_AA,
    ArtworkResult,
    ImageError,
    Palette,
    contrast,
    extract_palette,
)
from sonora_api.media.images import process as _process

from sonora_media.errors import MediaError

__all__ = [
    "FORMATS",
    "MIN_RECOMMENDED",
    "SIZES",
    "WCAG_AA",
    "ArtworkResult",
    "Palette",
    "contrast",
    "extract_palette",
    "process",
]


def process(data: bytes, out_dir: Path) -> ArtworkResult:
    try:
        return _process(data, out_dir)
    except ImageError as exc:
        raise MediaError(f"Обложка не читается (повреждена): {exc}") from exc
