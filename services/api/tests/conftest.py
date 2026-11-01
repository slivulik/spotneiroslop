import asyncio
import os
import threading
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from dramatiq.brokers.stub import StubBroker
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from sonora_api.core.config import Settings
from sonora_api.core.context import AppContext
from sonora_api.core.errors import UnauthorizedError
from sonora_api.core.ids import uuid7
from sonora_api.core.storage import PresignedUpload
from sonora_api.main import create_app
from sonora_api.models import Artist, Base, Release, ReleaseArtist, Track, TrackArtist, User
from sonora_api.models.enums import (
    ArtistRole,
    ReleaseStatus,
    ReleaseType,
    SourceFormat,
    TrackStatus,
    UserRole,
)
from sonora_api.services.email import ConsoleEmailSender
from sonora_api.services.google import GoogleIdentity

ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = os.environ.get(
    "SONORA_TEST_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/sonora_test"
)
REDIS_URL = os.environ.get("SONORA_TEST_REDIS_URL", "redis://localhost:6379/15")


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "env": "test",
        "log_json": False,
        "log_level": "INFO",
        "database_url": DATABASE_URL,
        "database_pool_size": 5,
        "redis_url": REDIS_URL,
        "jwt_secret": "test-secret-test-secret-test-secret-0123",
        "rate_limit_enabled": False,
        "google_client_ids": ["test-client"],
        "media_base_url": "https://cdn.test/media",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Build the schema through the real migrations (up, down, up again), so every test run
    also proves the migrations apply and roll back cleanly."""

    def run() -> None:
        cfg = Config(str(ROOT / "alembic.ini"))
        cfg.attributes["database_url"] = DATABASE_URL
        cfg.attributes["skip_logging_config"] = True
        asyncio.run(_reset_schema())
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")
        command.upgrade(cfg, "head")

    # env.py calls asyncio.run(), which can't nest inside pytest-asyncio's running loop.
    errors: list[BaseException] = []

    def target() -> None:
        try:
            run()
        except BaseException as exc:  # re-raised in the main thread below
            errors.append(exc)

    thread = threading.Thread(target=target)
    thread.start()
    thread.join()
    if errors:
        raise errors[0]


async def _reset_schema() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


class FakeGoogle:
    def __init__(self) -> None:
        self.identities: dict[str, GoogleIdentity] = {}

    async def verify(self, id_token: str) -> GoogleIdentity:
        if id_token not in self.identities:
            raise UnauthorizedError("Invalid Google ID token", code="invalid_google_token")
        return self.identities[id_token]


class FakeStorage:
    """In-memory object store: tests 'upload' by setting `objects[(bucket, key)] = size`."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], int] = {}

    def presign_upload(self, bucket: str, key: str, content_type: str) -> PresignedUpload:
        return PresignedUpload(
            url=f"https://s3.test/{bucket}/{key}?sig=1", method="PUT", headers={"Content-Type": content_type}
        )

    async def object_size(self, bucket: str, key: str) -> int | None:
        return self.objects.get((bucket, key))


@dataclass
class Harness:
    app: FastAPI
    client: AsyncClient
    email: ConsoleEmailSender
    google: FakeGoogle
    storage: FakeStorage
    broker: StubBroker

    @property
    def ctx(self) -> AppContext:
        ctx: AppContext = self.app.state.ctx
        return ctx


async def _make_harness(settings: Settings) -> AsyncIterator[Harness]:
    email, google, storage = ConsoleEmailSender(), FakeGoogle(), FakeStorage()
    broker = StubBroker()
    broker.declare_queue("media")
    app = create_app(settings, email=email, google=google, broker=broker, storage=storage)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield Harness(app=app, client=client, email=email, google=google, storage=storage, broker=broker)


@pytest.fixture
async def harness() -> AsyncIterator[Harness]:
    async for h in _make_harness(make_settings()):
        yield h


@pytest.fixture
async def limited_harness() -> AsyncIterator[Harness]:
    async for h in _make_harness(make_settings(rate_limit_enabled=True, rate_limit_auth_per_minute=4)):
        yield h


@pytest.fixture
def client(harness: Harness) -> AsyncClient:
    return harness.client


@pytest.fixture(autouse=True)
async def clean_state() -> AsyncIterator[None]:
    yield
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    await engine.dispose()
    redis = Redis.from_url(REDIS_URL)
    await redis.flushdb()
    await redis.aclose()


@pytest.fixture
async def db(harness: Harness) -> AsyncIterator[AsyncSession]:
    maker: async_sessionmaker[AsyncSession] = harness.ctx.sessionmaker
    async with maker() as session:
        yield session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DEVICE = {"platform": "web", "name": "Test browser"}


async def register(
    client: AsyncClient, email: str = "listener@example.com", password: str = "correct horse battery"
) -> dict[str, Any]:
    response = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": password, "display_name": "Listener", "device": DEVICE},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def bearer(tokens: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@dataclass
class Catalog:
    artist: Artist
    feat_artist: Artist
    album: Release
    single: Release
    hidden_release: Release
    tracks: list[Track]
    explicit_track: Track
    processing_track: Track


def _iter_ids() -> Iterator[int]:
    n = 0
    while True:
        n += 1
        yield n


_seq = _iter_ids()


def make_artist(name: str) -> Artist:
    n = next(_seq)
    return Artist(id=uuid7(), name=name, sort_name=name.lower(), slug=f"{name.lower().replace(' ', '-')}-{n}")


def make_release(
    title: str,
    artist: Artist,
    *,
    type_: ReleaseType = ReleaseType.ALBUM,
    released: date | None = None,
    status: ReleaseStatus = ReleaseStatus.PUBLISHED,
    publish_at: datetime | None = None,
) -> Release:
    release = Release(
        id=uuid7(),
        title=title,
        slug=title.lower().replace(" ", "-"),
        type=type_,
        release_date=released,
        status=status,
        publish_at=publish_at,
        cover_key=f"covers/{uuid.uuid4().hex}",
        palette={"dominant": "#112233", "text": "#FFFFFF"},
    )
    release.artist_links = [ReleaseArtist(artist_id=artist.id, role=ArtistRole.MAIN, position=0)]
    return release


def make_track(
    release: Release,
    number: int,
    artist: Artist,
    *,
    plays: int = 0,
    explicit: bool = False,
    status: TrackStatus = TrackStatus.READY,
    source: SourceFormat = SourceFormat.FLAC,
    bit_depth: int = 16,
    sample_rate: int = 44_100,
    feat: Artist | None = None,
) -> Track:
    track = Track(
        id=uuid7(),
        release_id=release.id,
        title=f"{release.title} #{number}",
        track_number=number,
        duration_ms=180_000 + number,
        is_explicit=explicit,
        source_format=source,
        source_bit_depth=bit_depth,
        source_sample_rate=sample_rate,
        status=status,
        play_count=plays,
    )
    links = [TrackArtist(artist_id=artist.id, role=ArtistRole.MAIN, position=0)]
    if feat is not None:
        links.append(TrackArtist(artist_id=feat.id, role=ArtistRole.FEAT, position=1))
    track.artist_links = links
    return track


@pytest.fixture
async def catalog_data(db: AsyncSession) -> Catalog:
    artist = make_artist("Night Shore")
    feat = make_artist("Guest Voice")
    album = make_release("Tides", artist, released=date(2025, 5, 1))
    single = make_release("Afterglow", artist, type_=ReleaseType.SINGLE, released=date(2026, 2, 14))
    hidden = make_release(
        "Embargoed", artist, released=date(2027, 1, 1), publish_at=datetime(2099, 1, 1, tzinfo=UTC)
    )
    db.add_all([artist, feat])
    await db.flush()
    db.add_all([album, single, hidden])
    await db.flush()
    tracks = [
        make_track(album, 1, artist, plays=50, bit_depth=24, sample_rate=96_000),
        make_track(album, 2, artist, plays=500, feat=feat),
        make_track(album, 3, artist, plays=5, source=SourceFormat.MP3, bit_depth=0, sample_rate=44_100),
    ]
    explicit = make_track(single, 1, artist, plays=1000, explicit=True)
    processing = make_track(album, 4, artist, plays=10_000, status=TrackStatus.PROCESSING)
    db.add_all([*tracks, explicit, processing, make_track(hidden, 1, artist, plays=99_999)])
    await db.commit()
    return Catalog(
        artist=artist,
        feat_artist=feat,
        album=album,
        single=single,
        hidden_release=hidden,
        tracks=tracks,
        explicit_track=explicit,
        processing_track=processing,
    )


async def make_admin(harness: Harness, email: str = "admin@example.com") -> dict[str, Any]:
    tokens = await register(harness.client, email=email)
    async with harness.ctx.sessionmaker() as s:
        user = await s.get(User, uuid.UUID(tokens["user"]["id"]))
        assert user is not None
        user.role = UserRole.ADMIN
        await s.commit()
    return tokens
