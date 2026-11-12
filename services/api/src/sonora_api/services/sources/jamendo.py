"""Jamendo (https://www.jamendo.com): independent music under Creative Commons licences.

API v3.0 `tracks` endpoint; needs a free client id from https://devportal.jamendo.com.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import replace
from typing import Any

import httpx

from sonora_api.core.logging import get_logger
from sonora_api.services.sources.base import (
    MAX_EXTERNAL_ID,
    SourceKey,
    SourceTrack,
    SourceUnavailableError,
    http_client,
    is_allowed_url,
)
from sonora_api.services.sources.licenses import parse_license

BASE = "https://api.jamendo.com/v3.0"
#: Jamendo answers `headers.code` 5 for an unknown or revoked client id.
INVALID_CLIENT_ID = 5

log = get_logger("sonora.sources.jamendo")


def _int(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


class JamendoSource:
    key: SourceKey = "jamendo"
    title = "Jamendo"
    description = "Независимые музыканты со всего мира, лицензии Creative Commons. Скачивание в FLAC."

    def __init__(self, client_id: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.client_id = client_id.strip()
        self.transport = transport

    def disabled_reason(self) -> str | None:
        if not self.client_id:
            return (
                "Нужен бесплатный ключ Jamendo: зарегистрируйте приложение на https://devportal.jamendo.com, "
                "впишите его Client ID в SONORA_JAMENDO_CLIENT_ID в файле .env и перезапустите API"
            )
        return None

    async def _tracks(self, params: dict[str, str]) -> list[dict[str, Any]]:
        query = {
            "client_id": self.client_id,
            "format": "json",
            "audioformat": "mp32",  # preview stream: VBR "good quality" MP3
            "audiodlformat": "flac",
            "imagesize": "600",
            **params,
        }
        try:
            async with http_client(self.transport) as http:
                response = await http.get(f"{BASE}/tracks/", params=query)
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("jamendo_unreachable", error=str(exc))
            raise SourceUnavailableError("Jamendo не отвечает — попробуйте позже") from exc
        headers = body.get("headers") if isinstance(body, dict) else None
        if response.status_code != 200 or not isinstance(headers, dict):
            raise SourceUnavailableError(f"Jamendo ответил ошибкой (HTTP {response.status_code})")
        if headers.get("status") != "success":
            if headers.get("code") == INVALID_CLIENT_ID:
                raise SourceUnavailableError(
                    "Jamendo не принял ключ: проверьте SONORA_JAMENDO_CLIENT_ID "
                    "(Client ID приложения на devportal.jamendo.com)"
                )
            message = _text(headers.get("error_message")) or "неизвестная ошибка"
            raise SourceUnavailableError(f"Jamendo ответил ошибкой: {message}")
        results = body.get("results")
        return [row for row in results if isinstance(row, dict)] if isinstance(results, list) else []

    @staticmethod
    def to_track(row: dict[str, Any]) -> SourceTrack | None:
        """Normalise one result; None unless it is downloadable under a free licence."""
        track_id = _int(row.get("id"))
        title, artist = _text(row.get("name")), _text(row.get("artist_name"))
        download = _text(row.get("audiodownload"))
        license_ = parse_license(_text(row.get("license_ccurl")))
        if track_id is None or not title or not artist or license_ is None:
            return None
        if not row.get("audiodownload_allowed") or not download or not is_allowed_url(download):
            return None
        external_id = str(track_id)
        if len(external_id) > MAX_EXTERNAL_ID:
            return None
        preview = _text(row.get("audio"))
        artwork = _text(row.get("image")) or _text(row.get("album_image"))
        return SourceTrack(
            source="jamendo",
            external_id=external_id,
            title=title,
            artist=artist,
            album=_text(row.get("album_name")),
            duration_s=_int(row.get("duration")),
            license=license_,
            artwork_url=artwork if artwork and is_allowed_url(artwork) else None,
            preview_url=preview if preview and preview.startswith("https://") else None,
            page_url=_text(row.get("shareurl")) or f"https://www.jamendo.com/track/{external_id}",
            format="flac",
            download_url=download,
            release_date=_text(row.get("releasedate")),
            track_number=_int(row.get("position")),
        )

    async def search(self, query: str, limit: int) -> list[SourceTrack]:
        rows = await self._tracks({"search": query, "limit": str(limit)})
        return [t for row in rows if (t := self.to_track(row)) is not None][:limit]

    async def resolve(self, external_ids: Sequence[str]) -> dict[str, SourceTrack]:
        ids = list(dict.fromkeys(i for i in external_ids if i.isascii() and i.isdigit()))
        if not ids:
            return {}
        # Same lookup twice: FLAC download links, and MP3 ones as a fallback for tracks that
        # have no lossless master on Jamendo.
        params = {"id": " ".join(ids), "limit": str(len(ids))}
        flac_rows, mp3_rows = await asyncio.gather(
            self._tracks(params), self._tracks({**params, "audiodlformat": "mp32"})
        )
        mp3_urls = {str(row.get("id")): _text(row.get("audiodownload")) for row in mp3_rows}
        found: dict[str, SourceTrack] = {}
        for row in flac_rows:
            track = self.to_track(row)
            if track is None or track.external_id not in ids:
                continue
            fallback = mp3_urls.get(track.external_id)
            if fallback and is_allowed_url(fallback) and fallback != track.download_url:
                track = replace(track, fallback_url=fallback)
            found[track.external_id] = track
        return found
