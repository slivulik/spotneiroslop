from typing import Any

from sonora_api.core.config import Settings
from sonora_api.schemas.catalog import Artwork, Palette

#: Square renditions produced by the media worker for every image.
ARTWORK_SIZES = [64, 160, 300, 640, 1200, 3000]
AVATAR_SIZES = [64, 160, 300, 640]


def media_url(settings: Settings, key: str) -> str:
    return f"{settings.media_base_url.rstrip('/')}/{key.lstrip('/')}"


def palette_out(raw: dict[str, Any] | None) -> Palette | None:
    return Palette.model_validate(raw) if raw else None


def artwork(
    settings: Settings,
    key: str | None,
    *,
    blurhash: str | None = None,
    palette: dict[str, Any] | None = None,
    sizes: list[int] = ARTWORK_SIZES,
) -> Artwork | None:
    if not key:
        return None
    return Artwork(
        url_template=f"{media_url(settings, key)}/{{size}}.{{format}}",
        sizes=sizes,
        blurhash=blurhash,
        palette=palette_out(palette),
    )
