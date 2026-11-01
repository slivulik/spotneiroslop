from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from redis.asyncio import Redis

from sonora_api import __version__
from sonora_api.core.config import Settings, get_settings
from sonora_api.core.context import AppContext
from sonora_api.core.db import create_engine, create_sessionmaker
from sonora_api.core.handlers import install_error_handlers
from sonora_api.core.logging import configure_logging, get_logger
from sonora_api.core.middleware import RequestContextMiddleware
from sonora_api.core.ratelimit import RateLimiter
from sonora_api.deps import default_rate_limit
from sonora_api.routers import auth, catalog, health, me
from sonora_api.services.email import EmailSender, create_email_sender
from sonora_api.services.google import GoogleIdTokenVerifier, GoogleVerifier

log = get_logger("sonora.app")


def _operation_id(route: APIRoute) -> str:
    """Stable, readable operation ids (`auth_login`, `catalog_get_track`) for generated clients."""
    tag = route.tags[0] if route.tags else "default"
    return f"{tag}_{route.name}"


def create_app(
    settings: Settings | None = None,
    *,
    email: EmailSender | None = None,
    google: GoogleVerifier | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.log_json, cache=settings.env != "test")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings)
        redis = Redis.from_url(settings.redis_url, decode_responses=False)
        app.state.ctx = AppContext(
            settings=settings,
            engine=engine,
            sessionmaker=create_sessionmaker(engine),
            redis=redis,
            rate_limiter=RateLimiter(redis),
            email=email or create_email_sender(settings),
            google=google or GoogleIdTokenVerifier(settings.google_client_ids),
        )
        log.info("startup", version=__version__, env=settings.env)
        try:
            yield
        finally:
            await redis.aclose()
            await engine.dispose()
            log.info("shutdown")

    app = FastAPI(
        title="Sonora API",
        version=__version__,
        summary="Music streaming: catalogue, library, personalised wave, playback.",
        lifespan=lifespan,
        docs_url=None if settings.is_prod else "/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
        generate_unique_id_function=_operation_id,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "If-None-Match", "X-Request-ID"],
        expose_headers=["ETag", "Retry-After", "X-Request-ID"],
        max_age=600,
    )
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    app.include_router(health.router)
    for router in (auth.router, me.router, catalog.router):
        app.include_router(router, dependencies=[Depends(default_rate_limit)])
    return app
