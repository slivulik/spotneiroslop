from typing import Annotated

from pydantic import Field, StringConstraints

from sonora_api.schemas.catalog import Artwork, Palette
from sonora_api.schemas.common import ApiModel

#: Keys produced by POST /v1/admin/images; anything else is rejected on write.
ImageKey = Annotated[str, StringConstraints(pattern=r"^images/[a-z]+/[0-9a-f]{12}$")]


class ImageRef(ApiModel):
    """Reference to an uploaded image, as returned by the image upload endpoint."""

    key: ImageKey
    blurhash: str | None = Field(default=None, max_length=64)
    palette: Palette | None = None


class ImageOut(ImageRef):
    artwork: Artwork
    width: int
