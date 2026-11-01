from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from sonora_api.core.config import Settings
from sonora_api.core.ratelimit import RateLimiter
from sonora_api.services.email import EmailSender
from sonora_api.services.google import GoogleVerifier


@dataclass(slots=True)
class AppContext:
    """Process-wide resources, created in the lifespan and shared by all requests."""

    settings: Settings
    engine: AsyncEngine
    sessionmaker: async_sessionmaker[AsyncSession]
    redis: Redis
    rate_limiter: RateLimiter
    email: EmailSender
    google: GoogleVerifier
