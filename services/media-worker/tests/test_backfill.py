"""Catalogue-wide pass: fills missing covers and synced lyrics, never touches manual lyrics."""

from pathlib import Path

import pytest
from sonora_api.enrich import covers, lrclib, musicbrainz
from sonora_api.enrich.covers import CoverMatch
from sonora_api.enrich.lrclib import LyricsMatch
from sonora_api.models import Lyrics, PlatformSetting, Release, Track
from sonora_api.models.enums import JobStatus, LyricsSource, LyricsType
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from sonora_media import backfill
from tests.conftest import AudioFiles, cover_png
from tests.test_pipeline import Harness


def test_backfill_finds_covers_and_synced_lyrics(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    h = Harness(tmp_path, sessions)
    # flac16 has no cover and no lyrics; uploads with lookups off leave both empty.
    assert h.pipeline.run(h.submit(audio.flac16, publish=True)) == JobStatus.SUCCEEDED
    with sessions() as s:
        release = s.scalars(select(Release)).one()
        track = s.scalars(select(Track)).one()
        assert release.cover_key is None
        assert s.get(Lyrics, track.id) is None

    asked: list[tuple[str, str]] = []

    def fake_cover(artist: str, album: str, **_: object) -> CoverMatch:
        asked.append((artist, album))
        return CoverMatch(cover_png(800), "https://www.deezer.com/album/1")

    monkeypatch.setattr(covers, "find", fake_cover)
    monkeypatch.setattr(
        lrclib,
        "find",
        lambda *a, **k: LyricsMatch("[00:01.00]Первая\n[00:03.00]Вторая", "Первая\nВторая", False, 7),
    )
    monkeypatch.setattr(musicbrainz, "find_artist_wikidata", lambda *a, **k: None)

    report = backfill.run(backfill.Env(h.settings, h.storage, sessions, tmp_path / "enrich"))
    assert (report.covers, report.lyrics_synced) == (1, 1)
    assert asked == [("Solo Artist", "Plain")]  # a lone track is searched as its own single
    with sessions() as s:
        stored = s.get(Release, release.id)
        assert stored is not None
        assert stored.cover_key
        assert stored.cover_key.startswith(f"covers/{stored.id}/")
        lyrics = s.get(Lyrics, track.id)
        assert lyrics is not None
        assert lyrics.type == LyricsType.LINE
        assert lyrics.source == LyricsSource.AUTO
        status = s.get(PlatformSetting, "enrich_status")
        assert status is not None
        assert status.value["running"] is False
        assert status.value["report"]["covers"] == 1

    # Second pass: nothing left to fill; manual plain lyrics are never replaced.
    with sessions.begin() as s:
        row = s.get(Lyrics, track.id)
        assert row is not None
        row.type, row.source, row.body = LyricsType.STATIC, LyricsSource.MANUAL, {"text": "Свой текст"}
    again = backfill.run(backfill.Env(h.settings, h.storage, sessions, tmp_path / "enrich2"))
    assert (again.covers, again.lyrics_synced, again.lyrics_plain) == (0, 0, 0)
    with sessions() as s:
        assert s.get(Lyrics, track.id).source == LyricsSource.MANUAL  # type: ignore[union-attr]
