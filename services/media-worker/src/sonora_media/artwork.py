"""Stage: cover renditions (AVIF/WebP/JPEG), blurhash and colour palette."""

from __future__ import annotations

import colorsys
import io
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from sonora_media import blurhash
from sonora_media.errors import MediaError

SIZES = (64, 160, 300, 640, 1200, 3000)
FORMATS = {
    "avif": {"quality": 60},
    "webp": {"quality": 82, "method": 6},
    "jpg": {"quality": 88, "progressive": True},
}
MIN_RECOMMENDED = 1200
MAX_PIXELS = 12_000 * 12_000
WCAG_AA = 4.5


@dataclass(frozen=True, slots=True)
class Palette:
    dominant: str
    accent: str
    vibrant: str
    muted_dark: str
    text: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ArtworkResult:
    source_size: int
    blurhash: str
    palette: Palette
    #: relative path → local file, e.g. "300.webp"
    files: dict[str, Path]

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_size": self.source_size,
            "blurhash": self.blurhash,
            "palette": self.palette.to_dict(),
        }


def load_square(data: bytes) -> Image.Image:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # decompression-bomb guard
    try:
        image: Image.Image = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        image.load()
    except (OSError, Image.DecompressionBombError) as exc:
        raise MediaError(f"Cover image is unreadable: {exc}") from exc
    image = image.convert("RGB")
    side = min(image.size)
    left, top = (image.width - side) // 2, (image.height - side) // 2
    return image.crop((left, top, left + side, top + side))


def render(image: Image.Image, out_dir: Path) -> dict[str, Path]:
    """All sizes in all formats. Sizes above the source reuse the source pixels (no upscaling),
    so every URL the template promises exists."""
    out_dir.mkdir(parents=True, exist_ok=True)
    files: dict[str, Path] = {}
    for size in SIZES:
        target = min(size, image.width)
        resized = image if target == image.width else image.resize((target, target), Image.Resampling.LANCZOS)
        for fmt, options in FORMATS.items():
            path = out_dir / f"{size}.{fmt}"
            resized.save(path, format="JPEG" if fmt == "jpg" else fmt.upper(), **options)
            files[path.name] = path
    return files


# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _luminance(rgb: tuple[int, int, int]) -> float:
    def lin(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _hsv(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    return colorsys.rgb_to_hsv(*(c / 255 for c in rgb))


def _rgb(h: float, s: float, v: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return round(r * 255), round(g * 255), round(b * 255)


def extract_palette(image: Image.Image) -> Palette:
    small = image.resize((64, 64), Image.Resampling.BILINEAR)
    quantized = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    raw_palette = quantized.getpalette() or []
    counts: list[tuple[int, int]] = sorted(quantized.getcolors() or [], reverse=True)  # type: ignore[arg-type]
    colors = [
        (count, (raw_palette[i * 3], raw_palette[i * 3 + 1], raw_palette[i * 3 + 2])) for count, i in counts
    ]
    dominant = colors[0][1]
    total = sum(c for c, _ in colors)

    # Vibrant: most saturated reasonably bright colour covering at least 3 % of the image.
    candidates = [rgb for count, rgb in colors if count / total >= 0.03]
    vibrant = max(candidates, key=lambda rgb: _hsv(rgb)[1] * (0.5 + _hsv(rgb)[2]))
    h, s, v = _hsv(vibrant)
    if s < 0.35:
        vibrant = _rgb(h, max(s, 0.35), max(v, 0.6))

    # Accent: vibrant, unless it's indistinguishable from the dominant colour.
    accent = vibrant
    if contrast(accent, dominant) < 1.5:
        h, s, v = _hsv(vibrant)
        accent = _rgb(h, min(1.0, s + 0.2), 0.95 if v < 0.6 else 0.45)

    dh, ds, _ = _hsv(dominant)
    muted_dark = _rgb(dh, min(ds, 0.45), 0.18)

    # Text over the dominant colour: near-white or near-black, whichever passes AA.
    light, dark = (245, 245, 247), (11, 11, 15)
    text = light if contrast(light, dominant) >= contrast(dark, dominant) else dark
    return Palette(
        dominant=_hex(dominant),
        accent=_hex(accent),
        vibrant=_hex(vibrant),
        muted_dark=_hex(muted_dark),
        text=_hex(text),
    )


def process(data: bytes, out_dir: Path) -> ArtworkResult:
    image = load_square(data)
    return ArtworkResult(
        source_size=image.width,
        blurhash=blurhash.encode(image),
        palette=extract_palette(image),
        files=render(image, out_dir),
    )
