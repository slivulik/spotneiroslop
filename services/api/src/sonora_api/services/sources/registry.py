"""The configured open catalogues, keyed by `SourceKey`."""

from __future__ import annotations

import httpx

from sonora_api.core.config import Settings
from sonora_api.services.sources.base import Source, SourceDisabledError, SourceKey
from sonora_api.services.sources.internet_archive import InternetArchiveSource
from sonora_api.services.sources.jamendo import JamendoSource

GLOBALLY_DISABLED = "Импорт из открытых источников выключен на сервере (SONORA_SOURCES_ENABLED=false)"


class SourceRegistry:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._enabled = settings.sources_enabled
        self._sources: dict[SourceKey, Source] = {
            "jamendo": JamendoSource(settings.jamendo_client_id, transport),
            "internet_archive": InternetArchiveSource(transport),
        }

    def all(self) -> list[Source]:
        return list(self._sources.values())

    def disabled_reason(self, source: Source) -> str | None:
        return GLOBALLY_DISABLED if not self._enabled else source.disabled_reason()

    def usable(self, key: SourceKey) -> Source:
        """The source, or 409 `source_disabled` with the reason (shown to the admin as is)."""
        source = self._sources[key]
        if (reason := self.disabled_reason(source)) is not None:
            raise SourceDisabledError(reason, details={"source": key})
        return source
