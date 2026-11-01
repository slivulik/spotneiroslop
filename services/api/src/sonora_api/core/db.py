from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from sonora_api.core.config import Settings


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        connect_args={
            "server_settings": {
                "statement_timeout": str(settings.database_statement_timeout_ms),
                "application_name": "sonora-api",
            }
        },
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
