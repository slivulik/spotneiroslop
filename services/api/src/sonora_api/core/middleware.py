import re
import time
import uuid

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from sonora_api.core.logging import get_logger

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
log = get_logger("sonora.access")


class RequestContextMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware overhead, streaming-safe).

    Accepts a sane incoming X-Request-ID (from Caddy or a client) or generates one, binds it
    to the log context, echoes it in the response and writes one access-log line per request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = next((v.decode() for k, v in scope["headers"] if k == b"x-request-id"), "")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        status = 500
        started = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", []).append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            route = scope.get("route")
            log.info(
                "request",
                method=scope["method"],
                path=scope["path"],
                route=getattr(route, "path", None),
                status=status,
                duration_ms=duration_ms,
                client=(scope.get("client") or ("-",))[0],
            )
