from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.context import AppContext
from sonora_api.core.errors import RateLimitedError, UnauthorizedError
from sonora_api.core.security import AccessClaims, decode_access_token
from sonora_api.models import User
from sonora_api.services.auth import is_device_revoked

_bearer = HTTPBearer(auto_error=False, description="Access token from /v1/auth/*")


def get_ctx(request: Request) -> AppContext:
    ctx: AppContext = request.app.state.ctx
    return ctx


Ctx = Annotated[AppContext, Depends(get_ctx)]


async def get_session(ctx: Ctx) -> AsyncIterator[AsyncSession]:
    """One session per request. Closing it rolls back anything left uncommitted and returns the
    connection to the pool deterministically (a nested async generator would only be closed by GC)."""
    async with ctx.sessionmaker() as session:
        yield session


Session = Annotated[AsyncSession, Depends(get_session)]


async def get_claims(
    ctx: Ctx, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> AccessClaims | None:
    if credentials is None:
        return None
    claims = decode_access_token(ctx.settings, credentials.credentials)
    if await is_device_revoked(ctx.redis, claims.device_id):
        raise UnauthorizedError("Session was signed out", code="session_revoked")
    return claims


Claims = Annotated[AccessClaims | None, Depends(get_claims)]


@dataclass(frozen=True, slots=True)
class Viewer:
    """The authenticated user plus the device the request came from."""

    user: User
    claims: AccessClaims


async def get_optional_viewer(session: Session, claims: Claims) -> Viewer | None:
    if claims is None:
        return None
    user = await session.get(User, claims.user_id)
    if user is None:
        raise UnauthorizedError("Account no longer exists", code="invalid_token")
    return Viewer(user=user, claims=claims)


async def get_viewer(viewer: Annotated[Viewer | None, Depends(get_optional_viewer)]) -> Viewer:
    if viewer is None:
        raise UnauthorizedError()
    return viewer


OptionalViewer = Annotated[Viewer | None, Depends(get_optional_viewer)]
CurrentViewer = Annotated[Viewer, Depends(get_viewer)]


def _client_ip(request: Request) -> str:
    # uvicorn's --proxy-headers / --forwarded-allow-ips resolves the real client from Caddy.
    return request.client.host if request.client else "unknown"


async def default_rate_limit(request: Request, ctx: Ctx, claims: Claims) -> None:
    """Applied to every /v1 route: budget per user, or per IP for anonymous traffic."""
    if not ctx.settings.rate_limit_enabled:
        return
    key = f"u:{claims.user_id}" if claims else f"ip:{_client_ip(request)}"
    result = await ctx.rate_limiter.hit(key, per_minute=ctx.settings.rate_limit_default_per_minute)
    if not result.allowed:
        raise RateLimitedError(result.retry_after)


async def auth_rate_limit(request: Request, ctx: Ctx) -> None:
    """Strict per-IP budget for credential endpoints (brute force / credential stuffing)."""
    if not ctx.settings.rate_limit_enabled:
        return
    per_minute = ctx.settings.rate_limit_auth_per_minute
    result = await ctx.rate_limiter.hit(
        f"auth:{request.url.path}:{_client_ip(request)}", per_minute=per_minute, burst=max(1, per_minute // 2)
    )
    if not result.allowed:
        raise RateLimitedError(result.retry_after)
