import uuid
from datetime import UTC
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from sonora_api.core.errors import AppError, ConflictError, NotFoundError
from sonora_api.core.ids import uuid7
from sonora_api.core.pagination import MAX_PAGE_SIZE, decode_cursor, encode_cursor
from sonora_api.core.tasks import enqueue_process_upload
from sonora_api.deps import AdminViewer, Ctx, Session
from sonora_api.models import Release, UploadJob
from sonora_api.models.enums import UPLOAD_STAGES, JobStatus, UploadStage
from sonora_api.routers import API_V1
from sonora_api.schemas.admin import (
    AUDIO_TYPES,
    COVER_TYPES,
    PresignedUploadOut,
    ReleasePatchIn,
    RetryIn,
    UploadCreatedOut,
    UploadCreateIn,
    UploadJobDetailOut,
    UploadJobOut,
)
from sonora_api.schemas.common import ERROR_RESPONSES, Page

router = APIRouter(prefix=f"{API_V1}/admin", tags=["admin"], responses=ERROR_RESPONSES)


def _ext(filename: str) -> str:
    return "." + filename.rsplit(".", 1)[-1].lower()


def _job_out(job: UploadJob) -> UploadJobOut:
    return UploadJobOut(
        id=job.id,
        status=job.status,
        stage=job.stage,
        error=job.error,
        files=job.files,
        warnings=job.warnings,
        options=job.options,
        attempts=job.attempts,
        completed_stages=[s.value for s in UPLOAD_STAGES if s.value in job.state],
        track_id=job.track_id,
        created_at=job.created_at,
        updated_at=job.updated_at,
        finished_at=job.finished_at,
    )


async def _get_job(session: Session, job_id: uuid.UUID, *, lock: bool = False) -> UploadJob:
    query = select(UploadJob).where(UploadJob.id == job_id)
    job = await session.scalar(query.with_for_update() if lock else query)
    if job is None:
        raise NotFoundError("Upload job not found")
    return job


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def create_upload(
    body: UploadCreateIn, admin: AdminViewer, session: Session, ctx: Ctx
) -> UploadCreatedOut:
    """Start an upload: returns presigned PUT URLs; upload the files, then call `/complete`."""
    if body.source.size_bytes > ctx.settings.max_upload_bytes:
        raise AppError("File is too large", code="file_too_large", status_code=413)
    job_id = uuid7()
    bucket = ctx.settings.s3_uploads_bucket
    files: list[dict[str, Any]] = []
    uploads: list[PresignedUploadOut] = []
    entries: list[tuple[Literal["source", "cover"], str, int, dict[str, str]]] = [
        ("source", body.source.filename, body.source.size_bytes, AUDIO_TYPES)
    ]
    if body.cover:
        entries.append(("cover", body.cover.filename, body.cover.size_bytes, COVER_TYPES))
    for role, filename, size, types in entries:
        ext = _ext(filename)
        key = f"jobs/{job_id}/{role}{ext}"
        presigned = ctx.storage.presign_upload(bucket, key, types[ext])
        files.append({"role": role, "key": key, "filename": filename, "size_bytes": size})
        uploads.append(
            PresignedUploadOut(
                role=role, url=presigned.url, method=presigned.method, headers=presigned.headers
            )
        )
    session.add(UploadJob(id=job_id, admin_id=admin.user.id, files=files, options=body.options.model_dump()))
    await session.commit()
    return UploadCreatedOut(job_id=job_id, uploads=uploads, expires_in=ctx.settings.upload_url_ttl_seconds)


@router.post("/uploads/{job_id}/complete")
async def complete_upload(job_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx) -> UploadJobOut:
    """Verify the files reached storage and queue the job for processing."""
    job = await _get_job(session, job_id, lock=True)
    if job.status != JobStatus.PENDING_UPLOAD:
        raise ConflictError("Upload was already completed", code="upload_already_completed")
    for file in job.files:
        size = await ctx.storage.object_size(ctx.settings.s3_uploads_bucket, file["key"])
        if size is None:
            raise AppError(f"{file['role']} file was not uploaded", code="upload_missing", status_code=409)
        if size != file["size_bytes"]:
            raise AppError(
                f"{file['role']} size mismatch: expected {file['size_bytes']}, got {size}",
                code="upload_size_mismatch",
                status_code=409,
            )
    job.status = JobStatus.QUEUED
    await session.commit()
    await enqueue_process_upload(ctx.broker, job.id)
    return _job_out(job)


_JOB_CURSOR_KEYS = frozenset({"id"})


@router.get("/uploads")
async def list_uploads(
    admin: AdminViewer,
    session: Session,
    status_filter: Annotated[list[JobStatus] | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    cursor: str | None = None,
) -> Page[UploadJobOut]:
    query = select(UploadJob).order_by(UploadJob.id.desc()).limit(limit + 1)
    if status_filter:
        query = query.where(UploadJob.status.in_(status_filter))
    if (after := decode_cursor(cursor, keys=_JOB_CURSOR_KEYS)) is not None:
        try:
            query = query.where(UploadJob.id < uuid.UUID(after["id"]))
        except (TypeError, ValueError) as exc:
            raise AppError("Malformed cursor", code="invalid_cursor") from exc
    rows = list(await session.scalars(query))
    next_cursor = encode_cursor({"id": str(rows[limit - 1].id)}) if len(rows) > limit else None
    return Page(items=[_job_out(j) for j in rows[:limit]], next_cursor=next_cursor)


@router.get("/uploads/{job_id}")
async def get_upload(job_id: uuid.UUID, admin: AdminViewer, session: Session) -> UploadJobDetailOut:
    job = await _get_job(session, job_id)
    return UploadJobDetailOut.model_validate({**_job_out(job).model_dump(), "logs": job.logs})


@router.post("/jobs/{job_id}/retry")
async def retry_job(
    job_id: uuid.UUID, body: RetryIn, admin: AdminViewer, session: Session, ctx: Ctx
) -> UploadJobOut:
    """Re-run a job from a stage. Checkpoints of that stage and every later one are discarded."""
    job = await _get_job(session, job_id, lock=True)
    if job.status in {JobStatus.PENDING_UPLOAD, JobStatus.QUEUED, JobStatus.RUNNING}:
        raise ConflictError("Job is not finished", code="job_not_finished")
    failed_stage = UploadStage(job.stage) if job.stage in {s.value for s in UPLOAD_STAGES} else None
    from_stage = body.from_stage or failed_stage or UPLOAD_STAGES[0]
    keep = UPLOAD_STAGES[: UPLOAD_STAGES.index(from_stage)]
    job.state = {k: v for k, v in job.state.items() if k in {s.value for s in keep}}
    job.status = JobStatus.QUEUED
    job.error = None
    job.finished_at = None
    await session.commit()
    await enqueue_process_upload(ctx.broker, job.id, from_stage.value)
    return _job_out(job)


@router.patch("/releases/{release_id}", status_code=status.HTTP_204_NO_CONTENT)
async def patch_release(
    release_id: uuid.UUID, body: ReleasePatchIn, admin: AdminViewer, session: Session
) -> None:
    """Publish/hide a release or set its embargo (`publish_at`)."""
    release = await session.get(Release, release_id)
    if release is None:
        raise NotFoundError("Release not found")
    changes = body.model_dump(exclude_unset=True)
    if "status" in changes:
        if changes["status"] is None:
            raise AppError("status cannot be null", code="validation_error", status_code=422)
        release.status = changes["status"]
    if "publish_at" in changes:
        publish_at = changes["publish_at"]
        release.publish_at = (
            publish_at.replace(tzinfo=UTC) if publish_at and publish_at.tzinfo is None else publish_at
        )
    await session.commit()
