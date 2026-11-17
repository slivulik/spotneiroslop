"""Admin: search open music catalogues (Jamendo, Internet Archive) and import from them.

Only Creative Commons / public-domain recordings are listed. An import re-resolves every id at the
source (client-supplied URLs are never used) and creates ordinary upload jobs; the media worker
downloads the file from an allow-listed host and runs the usual pipeline.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status

from sonora_api.core.errors import AppError, ConflictError, NotFoundError
from sonora_api.core.logging import get_logger
from sonora_api.core.tasks import enqueue_process_upload
from sonora_api.deps import AdminViewer, Ctx, Session
from sonora_api.routers import API_V1
from sonora_api.routers.admin import _job_out
from sonora_api.schemas.admin import UploadJobOut
from sonora_api.schemas.common import ERROR_RESPONSES, ErrorResponse
from sonora_api.schemas.sources import SourceImportIn, SourceOut, SourceTrackOut
from sonora_api.services.sources import importer
from sonora_api.services.sources.base import Source, SourceKey
from sonora_api.services.sources.registry import SourceRegistry

RESPONSES: dict[int | str, dict[str, Any]] = {**ERROR_RESPONSES, 502: {"model": ErrorResponse}}

router = APIRouter(prefix=f"{API_V1}/admin", tags=["admin"], responses=RESPONSES)
log = get_logger("sonora.admin.sources")


def get_sources(ctx: Ctx) -> SourceRegistry:
    """The configured catalogues (overridden in tests with a mocked HTTP transport)."""
    return SourceRegistry(ctx.settings)


Sources = Annotated[SourceRegistry, Depends(get_sources)]


class UnknownSourceItemsError(NotFoundError):
    code = "source_items_not_found"


@router.get("/sources")
async def list_sources(admin: AdminViewer, sources: Sources) -> list[SourceOut]:
    """Catalogues and whether each can be used right now (e.g. Jamendo needs a key)."""
    return [_source_out(sources, source) for source in sources.all()]


def _source_out(sources: SourceRegistry, source: Source) -> SourceOut:
    reason = sources.disabled_reason(source)
    return SourceOut(
        key=source.key,
        title=source.title,
        description=source.description,
        enabled=reason is None,
        disabled_reason=reason,
    )


@router.get("/sources/{key}/search")
async def search_source(
    key: SourceKey,
    admin: AdminViewer,
    session: Session,
    sources: Sources,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[SourceTrackOut]:
    """Free-licence tracks only; `already_imported` marks recordings already in the catalogue."""
    query = q.strip()
    if not query:
        raise AppError("Введите, что искать", code="empty_query", status_code=422)
    found = await sources.usable(key).search(query, limit)
    imported = await importer.imported_ids(session, key, [t.external_id for t in found])
    return [SourceTrackOut.from_track(t, already_imported=t.external_id in imported) for t in found]


@router.post("/sources/{key}/import", status_code=status.HTTP_202_ACCEPTED)
async def import_from_source(
    key: SourceKey, body: SourceImportIn, admin: AdminViewer, session: Session, ctx: Ctx, sources: Sources
) -> list[UploadJobOut]:
    """Queue one upload job per track; follow them in «Загрузка» (`GET /v1/admin/uploads`)."""
    source = sources.usable(key)
    ids = list(dict.fromkeys(i.strip() for i in body.external_ids if i.strip()))
    if not ids:
        raise AppError("Не выбрано ни одного трека", code="empty_selection", status_code=422)
    resolved = await source.resolve(ids)
    missing = [i for i in ids if i not in resolved]
    if missing:
        raise UnknownSourceItemsError(
            f"{source.title}: не найдено или не под свободной лицензией — {len(missing)} шт.",
            details={"external_ids": missing},
        )
    busy = await importer.imported_ids(session, key, ids) | await importer.importing_ids(session, key, ids)
    if busy:
        raise ConflictError(
            "Часть треков уже есть в каталоге или импортируется",
            code="already_imported",
            details={"external_ids": [i for i in ids if i in busy]},
        )
    jobs = importer.create_jobs(session, admin.user.id, [resolved[i] for i in ids], publish=body.publish)
    await session.commit()
    for job in jobs:
        await enqueue_process_upload(ctx.broker, job.id)
    log.info("source_import_queued", source=key, jobs=len(jobs), publish=body.publish)
    return [_job_out(job) for job in jobs]
