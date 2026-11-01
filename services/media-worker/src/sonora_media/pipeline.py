"""Runs an upload job through every stage, checkpointing each stage's output in
`upload_jobs.state` so a failed job resumes (or restarts) from any stage."""

from __future__ import annotations

import os
import tempfile
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sonora_api.models import Release, Track, TrackArtist, UploadJob
from sonora_api.models.enums import UPLOAD_STAGES, JobStatus, UploadStage
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from sonora_media import artwork, authenticity, catalog, enrich, loudness, preview, transcode, waveform
from sonora_media import fingerprint as fp
from sonora_media.config import WorkerSettings
from sonora_media.errors import MediaError
from sonora_media.ladder import plan_ladder
from sonora_media.logs import get_logger
from sonora_media.probe import ProbeResult, probe
from sonora_media.storage import MediaStorage, upload_dir
from sonora_media.tags import TrackTags, embedded_cover, read_tags
from sonora_media.tools import has_encoder

log = get_logger("sonora.media.pipeline")
MAX_LOG_ENTRIES = 500


@dataclass
class JobContext:
    settings: WorkerSettings
    storage: MediaStorage
    sessions: sessionmaker[Session]
    job_id: uuid.UUID
    files: list[dict[str, Any]]
    options: dict[str, Any]
    state: dict[str, Any]
    workdir: Path
    warnings: list[dict[str, Any]] = field(default_factory=list)
    _source: Path | None = None

    @property
    def source(self) -> Path:
        """Source audio, downloaded lazily (a resumed job may not need it at all)."""
        if self._source is None:
            entry = self._file("source")
            assert entry is not None  # noqa: S101 - the API always records a source
            self._source = self.workdir / f"source{Path(entry['key']).suffix}"
            self.storage.download(self.settings.s3_uploads_bucket, entry["key"], self._source)
        return self._source

    def cover_bytes(self) -> bytes | None:
        entry = self._file("cover")
        if entry is None:
            return None
        path = self.workdir / f"cover{Path(entry['key']).suffix}"
        self.storage.download(self.settings.s3_uploads_bucket, entry["key"], path)
        return path.read_bytes()

    def _file(self, role: str) -> dict[str, Any] | None:
        return next((f for f in self.files if f["role"] == role), None)

    @property
    def probe(self) -> ProbeResult:
        return ProbeResult.from_dict(self.state[UploadStage.PROBE])

    @property
    def tags(self) -> TrackTags:
        return TrackTags.from_dict(self.state[UploadStage.TAGS])

    @property
    def track_id(self) -> uuid.UUID:
        return uuid.UUID(self.state[UploadStage.CATALOG]["track_id"])

    @property
    def media_prefix(self) -> str:
        # The job id makes every key unique per processing run → objects are immutable/cacheable.
        return f"tracks/{self.track_id}/{self.job_id}"

    def warn(self, code: str, message: str, **details: Any) -> None:
        self.warnings.append({"code": code, "message": message, **details})


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------


def stage_probe(ctx: JobContext) -> dict[str, Any]:
    return probe(ctx.settings, ctx.source).to_dict()


def stage_authenticity(ctx: JobContext) -> dict[str, Any]:
    result = authenticity.analyze(ctx.settings, ctx.source, ctx.probe)
    if result.suspicious:
        ctx.warn(
            "suspected_lossy_source",
            f"Спектр обрывается на ~{result.cutoff_hz / 1000:.1f} кГц: "
            "FLAC, вероятно, сделан из MP3 или другого сжатого файла",
            cutoff_hz=result.cutoff_hz,
        )
    return result.to_dict()


def stage_tags(ctx: JobContext) -> dict[str, Any]:
    tags = read_tags(ctx.source)
    if not tags.artists:
        raise MediaError("Нет тега исполнителя (ARTIST / TPE1) — заполните его и загрузите снова")
    if not tags.title:
        stem = Path(next(f["filename"] for f in ctx.files if f["role"] == "source")).stem
        tags.title = stem.split(" - ", 1)[-1].strip() or stem
        ctx.warn("title_from_filename", f"Нет тега названия — взято из имени файла: «{tags.title}»")
    if not tags.album:
        ctx.warn("no_album", "Нет тега альбома — трек оформлен как сингл")
    return tags.to_dict()


def stage_fingerprint(ctx: JobContext) -> dict[str, Any]:
    sha = fp.sha256_file(ctx.source)
    encoded = fp.encode(fp.chromaprint(ctx.settings, ctx.source))
    previous = ctx.state.get(UploadStage.CATALOG, {}).get("track_id")
    with ctx.sessions() as session:
        duplicate = catalog.find_duplicate(
            session,
            sha256=sha,
            fingerprint=encoded,
            duration_ms=ctx.probe.duration_ms,
            exclude=uuid.UUID(previous) if previous else None,
        )
    if duplicate is not None:
        track_id, reason = duplicate
        if not ctx.options.get("allow_duplicate"):
            raise MediaError(
                f"Такой трек уже есть в каталоге ({reason}). "
                "Чтобы оставить оба, загрузите с «Разрешить дубликаты»"
            )
        ctx.warn("duplicate", f"Дубликат трека из каталога ({reason})", track_id=str(track_id))
    return {"sha256": sha, "fingerprint": encoded}


def stage_loudness(ctx: JobContext) -> dict[str, Any]:
    return loudness.measure(ctx.settings, ctx.source).to_dict()


def stage_catalog(ctx: JobContext) -> dict[str, Any]:
    previous = ctx.state.get(UploadStage.CATALOG, {}).get("track_id")
    with ctx.sessions.begin() as session:
        track = catalog.upsert_track(
            session,
            track_id=uuid.UUID(previous) if previous else _job_track_id(session, ctx.job_id),
            tags=ctx.tags,
            probe=ctx.state[UploadStage.PROBE],
            sha256=ctx.state[UploadStage.FINGERPRINT]["sha256"],
            fingerprint=ctx.state[UploadStage.FINGERPRINT]["fingerprint"],
            loudness=ctx.state[UploadStage.LOUDNESS],
        )
        job = session.get(UploadJob, ctx.job_id)
        assert job is not None  # noqa: S101
        job.track_id = track.id
        return {"track_id": str(track.id), "release_id": str(track.release_id)}


def _job_track_id(session: Session, job_id: uuid.UUID) -> uuid.UUID | None:
    return session.scalar(select(UploadJob.track_id).where(UploadJob.id == job_id))


def stage_transcode(ctx: JobContext) -> dict[str, Any]:
    plan = plan_ladder(ctx.probe, has_fdk_aac=has_encoder(ctx.settings, "libfdk_aac"))
    out_dir = ctx.workdir / "renditions"
    bucket, prefix = ctx.settings.s3_media_bucket, ctx.media_prefix
    # Each rendition is an independent ffmpeg process: encode them side by side.
    with ThreadPoolExecutor(max_workers=max(1, min(len(plan), os.cpu_count() or 2))) as pool:
        encoded = list(
            pool.map(lambda r: transcode.encode(ctx.settings, ctx.source, ctx.probe, r, out_dir), plan)
        )
    master = out_dir / "hls" / "master.m3u8"
    master.write_text(transcode.master_playlist(encoded))

    def push(e: transcode.EncodedRendition) -> None:
        ctx.storage.upload_file(bucket, f"{prefix}/files/{e.file.name}", e.file)
        upload_dir(ctx.storage, bucket, f"{prefix}/hls/{e.rendition.quality.value}", e.hls_dir)

    with ThreadPoolExecutor(max_workers=max(1, len(encoded))) as pool:
        list(pool.map(push, encoded))

    renditions = []
    for e in encoded:
        q = e.rendition.quality.value
        file_key = f"{prefix}/files/{e.file.name}"
        renditions.append(
            {
                **e.rendition.to_dict(),
                "storage_key": file_key,
                "hls_playlist_key": f"{prefix}/hls/{q}/playlist.m3u8",
                "size_bytes": e.size_bytes,
                "sha256": e.sha256,
                "encoder_delay": e.encoder_delay,
                "encoder_padding": e.encoder_padding,
                "peak_bitrate": e.peak_bitrate,
            }
        )
    master_key = f"{prefix}/hls/master.m3u8"
    ctx.storage.upload_file(bucket, master_key, master)
    return {"renditions": renditions, "hls_master_key": master_key}


def stage_waveform(ctx: JobContext) -> dict[str, Any]:
    return {"peaks": waveform.compute(ctx.settings, ctx.source)}


def stage_artwork(ctx: JobContext) -> dict[str, Any]:
    data = ctx.cover_bytes() or embedded_cover(ctx.source)
    release_id = ctx.state[UploadStage.CATALOG]["release_id"]
    has_cover = False
    if data is None:
        with ctx.sessions() as session:
            release = session.get(Release, uuid.UUID(release_id))
            has_cover = bool(release and release.cover_key)
        if not has_cover and enrich.enabled(ctx):
            data = enrich.cover(ctx)
            if data:
                ctx.warn("cover_found", "Обложка найдена в Cover Art Archive (MusicBrainz)")
    if data is None:
        if not has_cover:
            ctx.warn("no_cover", "Нет обложки (ни встроенной, ни загруженной) — релиз останется без картинки")
        return {"cover_key": None}
    result = artwork.process(data, ctx.workdir / "cover")
    if result.source_size < artwork.MIN_RECOMMENDED:
        ctx.warn(
            "small_cover",
            f"Обложка {result.source_size} px — лучше от {artwork.MIN_RECOMMENDED} px",
        )
    digest = fp.sha256_bytes(data)[:12]
    cover_key = f"covers/{release_id}/{digest}"
    upload_dir(ctx.storage, ctx.settings.s3_public_bucket, cover_key, ctx.workdir / "cover")
    return {"cover_key": cover_key, **result.to_dict()}


def stage_preview(ctx: JobContext) -> dict[str, Any]:
    out = ctx.workdir / "preview.m4a"
    start_ms = preview.render(ctx.settings, ctx.source, ctx.probe.duration_ms, out)
    key = f"{ctx.media_prefix}/preview.m4a"
    ctx.storage.upload_file(ctx.settings.s3_media_bucket, key, out)
    return {"key": key, "start_ms": start_ms}


def stage_lyrics(ctx: JobContext) -> dict[str, Any]:
    document = catalog.lyrics_document(ctx.tags, ctx.probe.duration_ms)
    if document is None:
        found = enrich.lyrics(ctx) if enrich.enabled(ctx) else None
        if found:
            ctx.warn(
                "lyrics_found", "Текст найден в LRCLIB" + (" (синхронный)" if found["type"] == "line" else "")
            )
        return {"lyrics": found}
    kind, body = document
    return {"lyrics": {"type": kind.value, "body": body}}


def stage_publish(ctx: JobContext) -> dict[str, Any]:
    s = ctx.state
    with ctx.sessions.begin() as session:
        track = session.get(Track, ctx.track_id)
        if track is None:
            raise MediaError("Трек удалили во время обработки")
        catalog.finalize_track(
            session,
            track,
            renditions=s[UploadStage.TRANSCODE]["renditions"],
            hls_master_key=s[UploadStage.TRANSCODE]["hls_master_key"],
            waveform=s[UploadStage.WAVEFORM]["peaks"],
            preview=s[UploadStage.PREVIEW],
            lyrics=s[UploadStage.LYRICS]["lyrics"],
            artwork=s[UploadStage.ARTWORK],
            channels=ctx.probe.channels,
            publish=bool(ctx.options.get("publish")),
            target_lufs=ctx.settings.target_lufs,
            peak_ceiling=ctx.settings.peak_ceiling_db,
        )
        artist_ids = list(
            session.scalars(select(TrackArtist.artist_id).where(TrackArtist.track_id == ctx.track_id))
        )
    # Photos and biographies for newly seen artists (once each; never fails the upload).
    if artist_ids and enrich.enabled(ctx):
        enrich.artists(ctx, artist_ids)
    return {"published": bool(ctx.options.get("publish"))}


STAGES: dict[UploadStage, Callable[[JobContext], dict[str, Any]]] = {
    UploadStage.PROBE: stage_probe,
    UploadStage.AUTHENTICITY: stage_authenticity,
    UploadStage.TAGS: stage_tags,
    UploadStage.FINGERPRINT: stage_fingerprint,
    UploadStage.LOUDNESS: stage_loudness,
    UploadStage.CATALOG: stage_catalog,
    UploadStage.TRANSCODE: stage_transcode,
    UploadStage.WAVEFORM: stage_waveform,
    UploadStage.ARTWORK: stage_artwork,
    UploadStage.PREVIEW: stage_preview,
    UploadStage.LYRICS: stage_lyrics,
    UploadStage.PUBLISH: stage_publish,
}
assert tuple(STAGES) == UPLOAD_STAGES  # noqa: S101 - keep API and worker stage lists in sync


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def _log_entry(stage: str | None, level: str, message: str) -> dict[str, Any]:
    return {"ts": datetime.now(UTC).isoformat(), "stage": stage, "level": level, "message": message}


def _append_logs(job: UploadJob, *entries: dict[str, Any]) -> None:
    job.logs = [*job.logs, *entries][-MAX_LOG_ENTRIES:]


class Pipeline:
    def __init__(
        self, settings: WorkerSettings, storage: MediaStorage, sessions: sessionmaker[Session]
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.sessions = sessions

    @classmethod
    def from_settings(cls, settings: WorkerSettings, storage: MediaStorage) -> Pipeline:
        engine = create_engine(settings.sync_database_url, pool_pre_ping=True, pool_size=5)
        return cls(settings, storage, sessionmaker(engine, expire_on_commit=False))

    def run(self, job_id: uuid.UUID) -> JobStatus:
        """Process a queued job. Returns the final status; never raises for media problems."""
        with self.sessions.begin() as session:
            job = session.scalar(
                select(UploadJob).where(UploadJob.id == job_id).with_for_update(skip_locked=True)
            )
            if job is None or job.status != JobStatus.QUEUED:
                # Duplicate delivery, or another worker already has it.
                log.info("job_skipped", job_id=str(job_id), status=job.status.value if job else None)
                return job.status if job else JobStatus.FAILED
            job.status = JobStatus.RUNNING
            job.attempts += 1
            job.error = None
            job.warnings = []
            _append_logs(job, _log_entry(None, "info", f"attempt {job.attempts} started"))
            files, options, state = list(job.files), dict(job.options), dict(job.state)

        self.settings.workdir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.settings.workdir, prefix=f"{job_id}-") as tmp:
            ctx = JobContext(
                settings=self.settings,
                storage=self.storage,
                sessions=self.sessions,
                job_id=job_id,
                files=files,
                options=options,
                state=state,
                workdir=Path(tmp),
            )
            return self._run_stages(ctx)

    def _run_stages(self, ctx: JobContext) -> JobStatus:
        stage: UploadStage | None = None
        try:
            for stage in UPLOAD_STAGES:
                if stage in ctx.state:
                    continue
                self._update(ctx, stage=stage, log=_log_entry(stage, "info", "started"))
                started = datetime.now(UTC)
                ctx.state[stage] = STAGES[stage](ctx)
                elapsed = (datetime.now(UTC) - started).total_seconds()
                self._update(
                    ctx,
                    stage=stage,
                    log=_log_entry(stage, "info", f"done in {elapsed:.1f}s"),
                    checkpoint=stage,
                )
                log.info("stage_done", job_id=str(ctx.job_id), stage=stage.value, seconds=round(elapsed, 2))
        except MediaError as exc:
            return self._fail(ctx, stage, str(exc))
        except Exception as exc:
            log.exception("stage_crashed", job_id=str(ctx.job_id), stage=stage.value if stage else None)
            detail = "".join(traceback.format_exception_only(exc)).strip()
            return self._fail(ctx, stage, f"Internal error: {detail}")
        self._finish(ctx, JobStatus.SUCCEEDED, stage=None, error=None, message="succeeded")
        return JobStatus.SUCCEEDED

    def _update(
        self,
        ctx: JobContext,
        *,
        stage: UploadStage,
        log: dict[str, Any],
        checkpoint: UploadStage | None = None,
    ) -> None:
        with self.sessions.begin() as session:
            job = session.get(UploadJob, ctx.job_id)
            assert job is not None  # noqa: S101
            job.stage = stage.value
            _append_logs(job, log)
            job.warnings = list(ctx.warnings)
            if checkpoint is not None:
                job.state = {**job.state, checkpoint.value: ctx.state[checkpoint]}

    def _fail(self, ctx: JobContext, stage: UploadStage | None, error: str) -> JobStatus:
        log.warning("job_failed", job_id=str(ctx.job_id), stage=stage.value if stage else None, error=error)
        self._finish(ctx, JobStatus.FAILED, stage=stage, error=error, message=f"failed: {error}")
        return JobStatus.FAILED

    def _finish(
        self,
        ctx: JobContext,
        status: JobStatus,
        *,
        stage: UploadStage | None,
        error: str | None,
        message: str,
    ) -> None:
        with self.sessions.begin() as session:
            job = session.get(UploadJob, ctx.job_id)
            assert job is not None  # noqa: S101
            job.status = status
            job.error = error
            job.warnings = list(ctx.warnings)
            job.finished_at = datetime.now(UTC)
            if stage is not None:
                job.stage = stage.value
            elif status == JobStatus.SUCCEEDED:
                job.stage = None
            _append_logs(
                job, _log_entry(stage.value if stage else None, "error" if error else "info", message)
            )
