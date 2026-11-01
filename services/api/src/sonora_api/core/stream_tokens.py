"""Stream tokens: authorise HLS playback of one track's renditions without per-request DB work.

The token carries the media prefix of the track (`tracks/<id>/<job>/hls`). Playlists are served
by the API under `/v1/stream/<token>/…`, so relative segment URIs resolve back to the API, which
answers each segment with a redirect to a freshly presigned object-storage URL valid for minutes.
The long-lived thing (the token) never grants direct storage access; the short-lived thing (the
presigned URL) is renewed on every request — rotation is invisible to the player.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError

_TYP = "stream"


@dataclass(frozen=True, slots=True)
class StreamGrant:
    track_id: uuid.UUID
    user_id: uuid.UUID
    prefix: str


def _key(settings: Settings) -> str:
    # Domain-separated from access tokens: a stream token can never pass as an access token.
    return f"stream:{settings.jwt_secret.get_secret_value()}"


def issue(settings: Settings, grant: StreamGrant, *, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {
        "typ": _TYP,
        "tid": str(grant.track_id),
        "uid": str(grant.user_id),
        "p": grant.prefix,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _key(settings), algorithm="HS256")


def verify(settings: Settings, token: str) -> StreamGrant:
    try:
        payload = jwt.decode(token, _key(settings), algorithms=["HS256"], options={"require": ["exp", "p"]})
    except jwt.ExpiredSignatureError as exc:
        raise AppError("Stream link expired", code="stream_expired", status_code=403) from exc
    except jwt.InvalidTokenError as exc:
        raise AppError("Invalid stream link", code="invalid_stream_token", status_code=403) from exc
    if payload.get("typ") != _TYP:
        raise AppError("Invalid stream link", code="invalid_stream_token", status_code=403)
    return StreamGrant(
        track_id=uuid.UUID(payload["tid"]), user_id=uuid.UUID(payload["uid"]), prefix=payload["p"]
    )
