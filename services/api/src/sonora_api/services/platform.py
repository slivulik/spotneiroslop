"""Service-wide switches ("streaming control") edited in the admin panel.

Stored as one JSONB row (`platform_settings.key = 'config'`) and validated here; missing keys
fall back to defaults, so adding a switch never needs a migration.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.errors import AppError
from sonora_api.models import PlatformSetting
from sonora_api.services.users import merge_patch

CONFIG_KEY = "config"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Banner(_Strict):
    enabled: bool = False
    text: str = Field(default="", max_length=280)
    link: str | None = Field(default=None, max_length=512)
    tone: Literal["info", "accent", "warning"] = "info"


class Maintenance(_Strict):
    enabled: bool = False
    message: str = Field(default="Идут технические работы. Скоро вернёмся.", max_length=280)


class PlatformConfig(_Strict):
    registration_open: bool = True
    lossless_enabled: bool = True
    hires_enabled: bool = True
    guest_previews: bool = True
    #: Default quality for new listeners' "auto" ladder is handled client-side; this caps it.
    max_quality: Literal["hires", "lossless", "high", "normal", "low"] = "hires"
    announcement: Banner = Field(default_factory=Banner)
    maintenance: Maintenance = Field(default_factory=Maintenance)
    #: Fill missing lyrics, covers and artist photos/bios from open databases.
    metadata_lookup: bool = True


async def get_config(session: AsyncSession) -> PlatformConfig:
    row = await session.get(PlatformSetting, CONFIG_KEY)
    try:
        return PlatformConfig.model_validate(row.value if row else {})
    except ValidationError:
        return PlatformConfig()


async def update_config(session: AsyncSession, patch: dict[str, Any], *, admin_id: Any) -> PlatformConfig:
    current = (await get_config(session)).model_dump()
    try:
        updated = PlatformConfig.model_validate(merge_patch(current, patch))
    except ValidationError as exc:
        fields = [
            {"loc": [str(p) for p in e["loc"]], "message": e["msg"]} for e in exc.errors(include_url=False)
        ]
        raise AppError(
            "Invalid settings", code="validation_error", status_code=422, details={"fields": fields}
        ) from exc
    row = await session.get(PlatformSetting, CONFIG_KEY)
    if row is None:
        row = PlatformSetting(key=CONFIG_KEY)
        session.add(row)
    row.value = updated.model_dump()
    row.updated_by = admin_id
    await session.commit()
    return updated
