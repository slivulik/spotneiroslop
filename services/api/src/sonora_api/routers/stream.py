import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query
from fastapi.responses import RedirectResponse, Response

from sonora_api.core import stream_tokens
from sonora_api.core.errors import NotFoundError
from sonora_api.deps import Ctx, CurrentViewer, Session
from sonora_api.routers import API_V1
from sonora_api.schemas.common import ERROR_RESPONSES
from sonora_api.schemas.stream import RequestedQuality, StreamOut
from sonora_api.services import streaming

router = APIRouter(prefix=API_V1, tags=["stream"], responses=ERROR_RESPONSES)

_NO_STORE = {"Cache-Control": "private, no-store"}


@router.get("/tracks/{track_id}/stream")
async def get_stream(
    track_id: uuid.UUID,
    viewer: CurrentViewer,
    session: Session,
    ctx: Ctx,
    quality: Annotated[RequestedQuality, Query()] = "auto",
) -> StreamOut:
    """HLS URL for playback. `auto` is adaptive over lossy tiers; a fixed quality is clamped
    down to what the track has (e.g. `hires` on a CD-quality track → `lossless`)."""
    return await streaming.stream_for(session, ctx.settings, track_id, viewer.user, quality)


@router.get("/tracks/{track_id}/preview", response_class=RedirectResponse, status_code=302)
async def get_preview(track_id: uuid.UUID, session: Session, ctx: Ctx) -> RedirectResponse:
    """30-second preview (AAC). Open to guests: share pages and the sign-up funnel use it."""
    key = await streaming.preview_key(session, track_id)
    url = ctx.storage.presign_get(
        ctx.settings.s3_media_bucket, key, ttl_seconds=streaming.SEGMENT_URL_TTL_SECONDS
    )
    return RedirectResponse(url, status_code=302, headers=_NO_STORE)


@router.get("/stream/{token}/{path:path}", include_in_schema=False)
async def stream_object(token: Annotated[str, Path()], path: str, ctx: Ctx) -> Response:
    """Playlists are served here (so relative URIs keep pointing at the API); init/media segments
    redirect to presigned storage URLs that live a few minutes."""
    grant = stream_tokens.verify(ctx.settings, token)
    if not streaming.STREAM_PATH_RE.match(path):
        raise NotFoundError("Not found")
    key = f"{grant.prefix}/{path}"
    if path.endswith(".m3u8"):
        body = await ctx.storage.read_bytes(ctx.settings.s3_media_bucket, key)
        if body is None:
            raise NotFoundError("Not found")
        return Response(
            body,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "private, max-age=300"},
        )
    url = ctx.storage.presign_get(
        ctx.settings.s3_media_bucket, key, ttl_seconds=streaming.SEGMENT_URL_TTL_SECONDS
    )
    return RedirectResponse(url, status_code=302, headers=_NO_STORE)
