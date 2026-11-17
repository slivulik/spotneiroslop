"""Catalogue side of imports: what is already in, and turning resolved tracks into upload jobs.

An import is an ordinary upload job (same table, same queue, same pipeline) whose source file the
media worker downloads itself in the first stage instead of receiving it from the browser.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.ids import uuid7
from sonora_api.models import Track, UploadJob
from sonora_api.models.enums import JobStatus
from sonora_api.services.sources.base import ImportJobOptions, SourceKey, SourceTrack

ACTIVE_JOB_STATUSES = (JobStatus.PENDING_UPLOAD, JobStatus.QUEUED, JobStatus.RUNNING)


async def imported_ids(session: AsyncSession, source: SourceKey, external_ids: Sequence[str]) -> set[str]:
    """External ids that already have a track in the catalogue."""
    if not external_ids:
        return set()
    rows = await session.scalars(
        select(Track.source_external_id).where(
            Track.source_name == source, Track.source_external_id.in_(list(external_ids))
        )
    )
    return {row for row in rows if row is not None}


async def importing_ids(session: AsyncSession, source: SourceKey, external_ids: Sequence[str]) -> set[str]:
    """External ids with an import job still queued or running (not a track yet)."""
    if not external_ids:
        return set()
    rows = await session.scalars(
        select(UploadJob.options).where(
            UploadJob.status.in_(ACTIVE_JOB_STATUSES), UploadJob.options.contains({"source": source})
        )
    )
    wanted = set(external_ids)
    return {str(options.get("external_id")) for options in rows} & wanted


def create_jobs(
    session: AsyncSession, admin_id: uuid.UUID, tracks: Sequence[SourceTrack], *, publish: bool
) -> list[UploadJob]:
    """Queued upload jobs, one per track, with no files yet: the worker's `fetch` stage downloads
    the source from the server-resolved URL and records it."""
    jobs = [
        UploadJob(
            id=uuid7(),
            admin_id=admin_id,
            files=[],
            options=ImportJobOptions.for_track(track, publish=publish).model_dump(mode="json"),
            status=JobStatus.QUEUED,
            # Everything the job listing reads, set up front: no lazy refresh after the commit.
            stage=None,
            error=None,
            logs=[],
            state={},
            warnings=[],
            attempts=0,
            track_id=None,
            finished_at=None,
        )
        for track in tracks
    ]
    session.add_all(jobs)
    return jobs
