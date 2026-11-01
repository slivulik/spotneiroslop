"""Admin image uploads: playlist/genre/artist/release covers (square) and hero banners (wide)."""

import hashlib
import tempfile
from pathlib import Path

import anyio.to_thread

from sonora_api.core.context import AppContext
from sonora_api.core.errors import AppError
from sonora_api.media.images import SIZES, WIDE_SIZES, ArtworkResult, ImageError, process, process_wide
from sonora_api.models.enums import ImageKind
from sonora_api.schemas.catalog import Palette
from sonora_api.schemas.media import ImageOut
from sonora_api.services.media import artwork
from sonora_api.storage_types import content_type_for

MAX_IMAGE_BYTES = 15 * 1024 * 1024


async def upload_image(ctx: AppContext, kind: ImageKind, data: bytes) -> ImageOut:
    if not data:
        raise AppError("Empty file", code="validation_error", status_code=422)
    if len(data) > MAX_IMAGE_BYTES:
        raise AppError("Image is larger than 15 MB", code="file_too_large", status_code=413)
    digest = hashlib.sha256(data).hexdigest()[:12]
    key = f"images/{kind.value}/{digest}"
    wide = kind == ImageKind.HERO

    with tempfile.TemporaryDirectory() as tmp:

        def run() -> ArtworkResult:
            return (process_wide if wide else process)(data, Path(tmp))

        try:
            result = await anyio.to_thread.run_sync(run)
        except ImageError as exc:
            raise AppError(str(exc), code="invalid_image", status_code=422) from exc
        for name, path in result.files.items():
            await ctx.storage.put_bytes(
                ctx.settings.s3_public_bucket, f"{key}/{name}", path.read_bytes(), content_type_for(name)
            )

    palette = result.palette.to_dict()
    art = artwork(
        ctx.settings,
        key,
        blurhash=result.blurhash,
        palette=palette,
        sizes=list(WIDE_SIZES if wide else SIZES),
    )
    assert art is not None  # noqa: S101 - key is non-empty
    return ImageOut(
        key=key,
        blurhash=result.blurhash,
        palette=Palette.model_validate(palette),
        artwork=art,
        width=result.source_size,
    )
