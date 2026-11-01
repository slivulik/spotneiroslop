"""Dramatiq actors. Message contract with the API: queue `media`, actor `process_upload`,
args `(job_id: str,)`, kwargs `{"from_stage": str}` (optional; the API already discarded the
later checkpoints, so the runner just resumes)."""

from __future__ import annotations

import uuid
from functools import cache

import dramatiq
from dramatiq.brokers.redis import RedisBroker
from sonora_api.core.tasks import MEDIA_QUEUE, PROCESS_UPLOAD_ACTOR

from sonora_media.config import get_settings
from sonora_media.logs import configure_logging, get_logger
from sonora_media.pipeline import Pipeline
from sonora_media.storage import S3Storage

settings = get_settings()
configure_logging(settings.log_level, json=settings.log_json)
dramatiq.set_broker(RedisBroker(url=settings.queue_url))
log = get_logger("sonora.media.actors")

#: Long hi-res albums take a while; Dramatiq's default limit is 10 minutes.
TIME_LIMIT_MS = 2 * 3600 * 1000


@cache
def pipeline() -> Pipeline:
    return Pipeline.from_settings(settings, S3Storage(settings))


@dramatiq.actor(
    actor_name=PROCESS_UPLOAD_ACTOR,
    queue_name=MEDIA_QUEUE,
    max_retries=0,  # failures are recorded on the job; admins retry explicitly from a stage
    time_limit=TIME_LIMIT_MS,
)
def process_upload(job_id: str, from_stage: str | None = None) -> None:
    status = pipeline().run(uuid.UUID(job_id))
    log.info("job_finished", job_id=job_id, status=status.value, from_stage=from_stage)
