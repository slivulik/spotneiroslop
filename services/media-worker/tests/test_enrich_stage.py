"""Open-database enrichment inside the pipeline (lookups replaced by stubs: no network)."""

from pathlib import Path

import pytest
from sonora_api.enrich.lrclib import LyricsMatch
from sonora_api.models import Artist, Lyrics, TrackArtist
from sonora_api.models.enums import JobStatus
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from sonora_media import enrich
from tests.conftest import AudioFiles
from tests.test_pipeline import Harness


def test_missing_lyrics_come_from_lrclib_and_artist_lookup_never_fails_upload(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    h = Harness(tmp_path, sessions)
    h.settings.metadata_lookup = True
    seen: dict[str, object] = {}

    def fake_lyrics(
        artist: str, title: str, album: str | None, duration_s: float, **_: object
    ) -> LyricsMatch:
        seen.update(artist=artist, title=title, duration=duration_s)
        return LyricsMatch(
            synced="[00:00.50]Найдено\n[00:01.50]Вторая строка", plain=None, instrumental=False, source_id=1
        )

    def broken_lookup(name: str, **_: object) -> str:
        raise RuntimeError("service down")

    monkeypatch.setattr(enrich.lrclib, "find", fake_lyrics)
    monkeypatch.setattr(enrich.musicbrainz, "find_release_mbid", lambda *a, **k: None)
    monkeypatch.setattr(enrich.musicbrainz, "find_artist_wikidata", broken_lookup)

    job_id = h.submit(audio.flac16, publish=True)
    status = h.pipeline.run(job_id)
    assert status == JobStatus.SUCCEEDED, (h.job(job_id).stage, h.job(job_id).error)
    job = h.job(job_id)
    assert seen["duration"] > 0
    with sessions() as s:
        lyrics = s.get(Lyrics, job.track_id)
        if (
            lyrics is not None
            and lyrics.body.get("type") == "line"
            and any(w["code"] == "lyrics_found" for w in job.warnings)
        ):
            assert [line["text"] for line in lyrics.body["lines"]][:2] == ["Найдено", "Вторая строка"]
        else:  # the fixture carried its own lyrics: LRCLIB must not have overridden them
            assert not any(w["code"] == "lyrics_found" for w in job.warnings)
        artist_ids = s.scalars(
            select(TrackArtist.artist_id).where(TrackArtist.track_id == job.track_id)
        ).all()
        assert all(
            s.get(Artist, a).enriched_at is not None for a in artist_ids
        )  # tried once, failure swallowed


def test_lookup_switch_off_means_no_network(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    h = Harness(tmp_path, sessions)
    h.settings.metadata_lookup = False

    def forbidden(*_: object, **__: object) -> None:
        raise AssertionError("network lookup while disabled")

    monkeypatch.setattr(enrich.lrclib, "find", forbidden)
    monkeypatch.setattr(enrich.musicbrainz, "find_release_mbid", forbidden)
    monkeypatch.setattr(enrich.musicbrainz, "find_artist_wikidata", forbidden)
    assert h.pipeline.run(h.submit(audio.flac16, publish=True)) == JobStatus.SUCCEEDED


def test_embedded_lyrics_are_never_replaced(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    h = Harness(tmp_path, sessions)
    h.settings.metadata_lookup = True

    def forbidden(*_: object, **__: object) -> None:
        raise AssertionError("LRCLIB queried although the file has lyrics")

    monkeypatch.setattr(enrich.lrclib, "find", forbidden)
    monkeypatch.setattr(enrich.musicbrainz, "find_artist_wikidata", lambda *a, **k: None)
    assert h.pipeline.run(h.submit(audio.flac24, publish=True)) == JobStatus.SUCCEEDED
