import shutil
import uuid
from pathlib import Path
from typing import Any

from sonora_api.models import (
    Artist,
    Genre,
    Lyrics,
    Release,
    Track,
    TrackArtist,
    TrackFeatures,
    TrackFile,
    UploadJob,
)
from sonora_api.models.enums import (
    ArtistRole,
    JobStatus,
    ReleaseStatus,
    ReleaseType,
    TrackStatus,
    UploadStage,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from sonora_media.config import WorkerSettings
from sonora_media.pipeline import Pipeline
from sonora_media.storage import LocalStorage
from tests.conftest import AudioFiles, make_settings

UPLOADS = "sonora-uploads"
MEDIA = "sonora-media"


class Harness:
    def __init__(self, tmp: Path, sessions: sessionmaker[Session]) -> None:
        self.settings: WorkerSettings = make_settings(tmp)
        self.storage = LocalStorage(tmp / "s3")
        self.sessions = sessions
        self.pipeline = Pipeline(self.settings, self.storage, sessions)

    def submit(self, source: Path, *, cover: Path | None = None, **options: Any) -> uuid.UUID:
        job_id = uuid.uuid4()
        files = []
        for role, path in (("source", source), ("cover", cover)):
            if path is None:
                continue
            key = f"jobs/{job_id}/{role}{path.suffix}"
            target = self.storage.path(UPLOADS, key)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            files.append({"role": role, "key": key, "filename": path.name, "size_bytes": path.stat().st_size})
        with self.sessions.begin() as session:
            session.add(UploadJob(id=job_id, files=files, options=options, status=JobStatus.QUEUED))
        return job_id

    def job(self, job_id: uuid.UUID) -> UploadJob:
        with self.sessions() as session:
            job = session.get(UploadJob, job_id)
            assert job is not None
            return job

    def media_exists(self, key: str) -> bool:
        return self.storage.path(MEDIA, key).is_file()


def test_full_pipeline_hires_flac(tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles) -> None:
    h = Harness(tmp_path, sessions)
    job_id = h.submit(audio.flac24, publish=True)
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED

    job = h.job(job_id)
    assert job.status == JobStatus.SUCCEEDED
    assert job.error is None
    assert job.attempts == 1
    assert job.finished_at is not None
    assert set(job.state) == {s.value for s in UploadStage}
    assert [entry["message"] for entry in job.logs][-1] == "succeeded"
    assert job.warnings == []  # genuine hi-res with a 1400 px cover

    with sessions() as s:
        track = s.get(Track, job.track_id)
        assert track is not None
        assert (track.title, track.version, track.track_number) == ("Морской ветер", "Live", 2)
        assert track.status == TrackStatus.READY
        assert (track.source_bit_depth, track.source_sample_rate) == (24, 96_000)
        assert track.track_gain is not None
        assert track.album_gain == track.track_gain  # only track on the album so far
        assert track.has_lyrics
        assert track.hls_master_key is not None
        assert h.media_exists(track.hls_master_key)
        assert track.preview_key is not None
        assert h.media_exists(track.preview_key)

        links = s.execute(
            select(Artist.name, TrackArtist.role)
            .join(TrackArtist, TrackArtist.artist_id == Artist.id)
            .where(TrackArtist.track_id == track.id)
            .order_by(TrackArtist.position)
        ).all()
        assert [tuple(row) for row in links] == [
            ("Night Shore", ArtistRole.MAIN),
            ("Second Hand", ArtistRole.MAIN),
            ("Guest Voice", ArtistRole.FEAT),
        ]

        files = {
            f.quality.value: f for f in s.scalars(select(TrackFile).where(TrackFile.track_id == track.id))
        }
        assert set(files) == {"hires", "lossless", "high", "normal", "low"}
        assert (files["hires"].bit_depth, files["hires"].sample_rate) == (24, 96_000)
        for f in files.values():
            assert h.media_exists(f.storage_key)
            assert f.hls_playlist_key is not None
            assert h.media_exists(f.hls_playlist_key)

        features = s.get(TrackFeatures, track.id)
        assert features is not None
        assert features.waveform is not None
        assert len(features.waveform) == 800

        lyrics = s.get(Lyrics, track.id)
        assert lyrics is not None
        assert lyrics.body["type"] == "line"
        assert [line["text"] for line in lyrics.body["lines"]] == ["Первая строка", "Second line", "Третья"]
        assert lyrics.body["lines"][-1]["end_ms"] == track.duration_ms

        release = s.get(Release, track.release_id)
        assert release is not None
        assert (release.title, release.type, release.status) == (
            "Tides",
            ReleaseType.ALBUM,
            ReleaseStatus.PUBLISHED,
        )
        assert release.track_count == 1
        assert release.cover_key is not None
        assert release.cover_blurhash is not None
        assert release.palette is not None
        assert release.palette["text"] in {"#F5F5F7", "#0B0B0F"}
        assert h.media_exists(f"public/{release.cover_key}/640.avif")
        assert h.media_exists(f"public/{release.cover_key}/3000.jpg")
        assert s.scalar(select(Genre.slug).where(Genre.name == "Indie")) == "indie"


def test_mp3_with_static_lyrics_stays_draft(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    job_id = h.submit(audio.mp3)
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED
    job = h.job(job_id)
    assert {w["code"] for w in job.warnings} == {"small_cover"}  # embedded cover is 600 px
    with sessions() as s:
        track = s.get(Track, job.track_id)
        assert track is not None
        qualities = set(s.scalars(select(TrackFile.quality).where(TrackFile.track_id == track.id)))
        assert {q.value for q in qualities} == {"high", "normal", "low"}
        lyrics = s.get(Lyrics, track.id)
        assert lyrics is not None
        assert lyrics.body == {"version": 1, "type": "static", "text": "Просто текст\nбез таймкодов"}
        release = s.get(Release, track.release_id)
        assert release is not None
        assert release.status == ReleaseStatus.DRAFT  # not published without the option


def test_duplicates_rejected_unless_allowed(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    assert h.pipeline.run(h.submit(audio.flac16)) == JobStatus.SUCCEEDED

    duplicate = h.submit(audio.flac16)
    assert h.pipeline.run(duplicate) == JobStatus.FAILED
    job = h.job(duplicate)
    assert job.stage == "fingerprint"
    assert job.error is not None
    assert "identical file" in job.error

    allowed = h.submit(audio.flac16, allow_duplicate=True)
    assert h.pipeline.run(allowed) == JobStatus.FAILED  # identical bytes still collide on the unique hash
    assert h.job(allowed).stage == "catalog"


def test_suspicious_lossless_is_flagged_not_rejected(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    job_id = h.submit(audio.fake_lossless)
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED
    codes = {w["code"] for w in h.job(job_id).warnings}
    assert "suspected_lossy_source" in codes
    assert "no_cover" in codes


def test_retry_from_stage_reuses_checkpoints(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    job_id = h.submit(audio.flac16)
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED
    first = h.job(job_id)

    # What the API's retry endpoint does: drop checkpoints from `transcode` on and re-queue.
    keep = [s.value for s in UploadStage][: list(UploadStage).index(UploadStage.TRANSCODE)]
    with sessions.begin() as s:
        job = s.get(UploadJob, job_id)
        assert job is not None
        job.state = {k: v for k, v in job.state.items() if k in keep}
        job.status = JobStatus.QUEUED
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED

    second = h.job(job_id)
    assert second.attempts == 2
    assert second.track_id == first.track_id  # same track updated, not a new one
    assert second.state["fingerprint"] == first.state["fingerprint"]
    started = [e["stage"] for e in second.logs if e["message"] == "started"]
    assert started[-6:] == ["transcode", "waveform", "artwork", "preview", "lyrics", "publish"]
    with sessions() as s:
        assert len(list(s.scalars(select(Track)))) == 1
        assert len(list(s.scalars(select(TrackFile)))) == 4  # lossless, high, normal, low


def test_corrupt_upload_fails_with_clear_message(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    job_id = h.submit(audio.corrupt)
    assert h.pipeline.run(job_id) == JobStatus.FAILED
    job = h.job(job_id)
    assert job.stage == "probe"
    assert job.error is not None
    assert "damaged" in job.error
    assert job.track_id is None


def test_duplicate_delivery_is_ignored(
    tmp_path: Path, sessions: sessionmaker[Session], audio: AudioFiles
) -> None:
    h = Harness(tmp_path, sessions)
    job_id = h.submit(audio.flac16)
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED
    assert h.pipeline.run(job_id) == JobStatus.SUCCEEDED  # second message: job no longer queued
    assert h.job(job_id).attempts == 1
