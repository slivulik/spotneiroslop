import base64
import binascii
from typing import Any

import orjson

from sonora_api.core.errors import AppError

MAX_PAGE_SIZE = 100


def encode_cursor(values: dict[str, Any]) -> str:
    """Opaque keyset cursor: the sort key of the last row on the page."""
    return base64.urlsafe_b64encode(orjson.dumps(values)).rstrip(b"=").decode()


def decode_cursor(cursor: str | None, *, keys: frozenset[str]) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        values = orjson.loads(raw)
    except (binascii.Error, ValueError, orjson.JSONDecodeError) as exc:
        raise AppError("Malformed cursor", code="invalid_cursor") from exc
    if not isinstance(values, dict) or set(values) != keys:
        raise AppError("Malformed cursor", code="invalid_cursor")
    return values
