import os
import random
import subprocess
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TALB, TIT2, TPE1, TRCK, USLT
from PIL import Image, ImageDraw
from sonora_api.models import Base
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from sonora_media.config import WorkerSettings

API_ROOT = Path(__file__).resolve().parents[2] / "api"
DATABASE_URL = os.environ.get(
    "SONORA_WORKER_TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/sonora_worker_test",
)
LRC = "[00:01.00]Первая строка\n[00:04.50]Second line\n[00:08.00]Третья"


def sh(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def make_settings(tmp: Path) -> WorkerSettings:
    return WorkerSettings(_env_file=None, database_url=DATABASE_URL, workdir=tmp / "work", log_json=False)  # type: ignore[call-arg]


def cover_png(size: int = 1400) -> bytes:
    image = Image.new("RGB", (size, size), (20, 40, 120))
    draw = ImageDraw.Draw(image)
    draw.ellipse((size // 4, size // 4, size * 3 // 4, size * 3 // 4), fill=(240, 80, 40))
    path = Path(f"/tmp/cover-{size}-{os.getpid()}.png")  # noqa: S108
    image.save(path)
    return path.read_bytes()


@dataclass
class AudioFiles:
    flac24: Path
    flac16: Path
    mp3: Path
    fake_lossless: Path
    other_flac: Path
    corrupt: Path
    not_audio: Path


def _melody(seed: int) -> str:
    """A tone sequence that changes note every 0.5 s (seeded), so each fixture is a different
    "recording" for the chroma-based fingerprint."""
    notes = [220, 247, 262, 294, 330, 349, 392, 440]
    generator = random.Random(seed)
    rng = [generator.randrange(len(notes)) for _ in range(64)]
    expr = "+".join(f"between(t,{i * 0.5},{i * 0.5 + 0.5})*sin(2*PI*{notes[n]}*t)" for i, n in enumerate(rng))
    return f"aevalsrc='0.35*({expr})':s=48000:d={{d}}"


def _music(out: Path, *args: str, duration: int = 20, seed: int = 7, rate: int = 96_000) -> None:
    """Melody + full-band pink noise up to Nyquist, stereo."""
    inputs = ["-f", "lavfi", "-i", _melody(seed).format(d=duration)]
    inputs += ["-f", "lavfi", "-i", f"anoisesrc=color=pink:a=0.08:d={duration}:seed={seed}"]
    mix = (
        "[0]aresample=" + str(rate) + "[m];[1]aresample=" + str(rate) + "[n];[m][n]amix=inputs=2:normalize=0"
    )
    mix += ",aformat=channel_layouts=stereo,volume=0.7"
    sh(*inputs, "-filter_complex", mix, "-ar", str(rate), *args, str(out))


@pytest.fixture(scope="session")
def audio(tmp_path_factory: pytest.TempPathFactory) -> AudioFiles:
    d = tmp_path_factory.mktemp("audio")
    flac24 = d / "hires.flac"
    _music(flac24, "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24")
    tags = FLAC(flac24)
    tags["TITLE"] = "Морской ветер (feat. Guest Voice) (Live)"
    tags["ARTIST"] = "Night Shore & Second Hand"
    tags["ALBUMARTIST"] = "Night Shore"
    tags["ALBUM"] = "Tides"
    tags["TRACKNUMBER"] = "2/10"
    tags["DATE"] = "2025-05-01"
    tags["GENRE"] = "Indie; Rock"
    tags["ISRC"] = "RU-A01-25-00001"
    tags["LYRICS"] = LRC
    tags["COMPOSER"] = "A. Composer"
    picture = Picture()
    picture.type, picture.mime, picture.data = 3, "image/png", cover_png()
    tags.add_picture(picture)
    tags.save()

    flac16 = d / "cd.flac"
    _music(flac16, "-c:a", "flac", "-sample_fmt", "s16", duration=15, seed=11, rate=44_100)
    cd = FLAC(flac16)
    cd["TITLE"], cd["ARTIST"] = "Plain", "Solo Artist"
    cd.save()

    mp3 = d / "track.mp3"
    _music(mp3, "-c:a", "libmp3lame", "-b:a", "320k", duration=15, seed=13, rate=44_100)
    id3 = ID3()
    id3.add(TIT2(encoding=3, text="MP3 Song"))
    id3.add(TPE1(encoding=3, text="Lame Band"))
    id3.add(TALB(encoding=3, text="Lossy LP"))
    id3.add(TRCK(encoding=3, text="1/2"))
    id3.add(USLT(encoding=3, lang="rus", desc="", text="Просто текст\nбез таймкодов"))
    id3.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=cover_png(600)))
    id3.save(mp3)

    lossy = d / "lossy128.mp3"
    _music(lossy, "-c:a", "libmp3lame", "-b:a", "128k", duration=20, seed=17, rate=44_100)
    fake = d / "fake.flac"
    sh("-i", str(lossy), "-c:a", "flac", "-sample_fmt", "s16", str(fake))
    fake_tags = FLAC(fake)
    fake_tags["TITLE"], fake_tags["ARTIST"] = "Fake", "Pretender"
    fake_tags.save()

    other = d / "other.flac"
    _music(other, "-c:a", "flac", "-sample_fmt", "s16", duration=20, seed=99, rate=44_100)

    corrupt = d / "corrupt.flac"
    data = bytearray(flac16.read_bytes())
    mid = len(data) // 2
    data[mid : mid + 4000] = os.urandom(4000)
    corrupt.write_bytes(bytes(data))

    not_audio = d / "notes.flac"
    not_audio.write_text("definitely not audio")
    return AudioFiles(flac24, flac16, mp3, fake, other, corrupt, not_audio)


@pytest.fixture(scope="session")
def settings(tmp_path_factory: pytest.TempPathFactory) -> WorkerSettings:
    return make_settings(tmp_path_factory.mktemp("settings"))


@pytest.fixture(scope="session")
def migrated() -> None:
    """Schema via the API's Alembic migrations (the worker writes the same tables)."""

    def run() -> None:
        engine = create_engine(DATABASE_URL.replace("+asyncpg", "+psycopg"))
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        cfg = Config(str(API_ROOT / "alembic.ini"))
        cfg.set_main_option("script_location", str(API_ROOT / "migrations"))
        cfg.attributes["database_url"] = DATABASE_URL
        cfg.attributes["skip_logging_config"] = True
        command.upgrade(cfg, "head")

    errors: list[BaseException] = []
    thread = threading.Thread(target=lambda: _capture(run, errors))
    thread.start()
    thread.join()
    if errors:
        raise errors[0]


def _capture(fn: object, errors: list[BaseException]) -> None:
    try:
        fn()  # type: ignore[operator]
    except BaseException as exc:
        errors.append(exc)


@pytest.fixture
def sessions(migrated: None) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(DATABASE_URL.replace("+asyncpg", "+psycopg"))
    yield sessionmaker(engine, expire_on_commit=False)
    with engine.begin() as conn:
        tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    engine.dispose()


def new_id() -> uuid.UUID:
    return uuid.uuid4()
