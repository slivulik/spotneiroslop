"""Enqueueing background work for the media worker.

The API never imports worker code: messages are addressed by queue and actor name, which
is the contract with `services/media-worker` (see its `actors.py`).
"""

import uuid

import anyio.to_thread
import dramatiq
from dramatiq.brokers.redis import RedisBroker

MEDIA_QUEUE = "media"
PROCESS_UPLOAD_ACTOR = "process_upload"


def create_broker(url: str) -> dramatiq.Broker:
    return RedisBroker(url=url)  # type: ignore[no-untyped-call]  # dramatiq ships no annotations here


async def enqueue_process_upload(
    broker: dramatiq.Broker, job_id: uuid.UUID, from_stage: str | None = None
) -> str:
    message: dramatiq.Message[None] = dramatiq.Message(
        queue_name=MEDIA_QUEUE,
        actor_name=PROCESS_UPLOAD_ACTOR,
        args=(str(job_id),),
        kwargs={"from_stage": from_stage} if from_stage else {},
        options={},
    )
    await anyio.to_thread.run_sync(broker.enqueue, message)
    return message.message_id
