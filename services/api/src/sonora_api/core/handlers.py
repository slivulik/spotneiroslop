from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from sonora_api.core.errors import AppError
from sonora_api.core.logging import get_logger

log = get_logger("sonora.errors")

_HTTP_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    406: "not_acceptable",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "rate_limited",
}


def error_body(
    request: Request, code: str, message: str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": getattr(request.state, "request_id", None),
        }
    }


async def _app_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)  # noqa: S101 - narrowing for the type checker
    return JSONResponse(
        error_body(request, exc.code, exc.message, exc.details),
        status_code=exc.status_code,
        headers=exc.headers,
    )


async def _http_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    return JSONResponse(
        error_body(request, code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers
    )


async def _validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101
    fields = [
        {"loc": [str(p) for p in err["loc"]], "message": err["msg"], "type": err["type"]}
        for err in exc.errors()
    ]
    return JSONResponse(
        error_body(request, "validation_error", "Request validation failed", {"fields": fields}),
        status_code=422,
    )


async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_error", exc_type=type(exc).__name__)
    return JSONResponse(error_body(request, "internal_error", "Internal server error"), status_code=500)


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled)
