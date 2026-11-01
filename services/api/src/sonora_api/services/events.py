"""Playback events from players: plays (≥ 30 s or ≥ 50 %), history, live "now playing"."""

import json
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.models import ListeningHistory, Track
from sonora_api.models.users import User
from sonora_api.schemas.events import EventsIn, EventsOut
from sonora_api.services.admin_users import NOW_PLAYING_PREFIX
from sonora_api.services.users import read_settings

PLAY_MIN_MS = 30_000
#: A "now playing" entry outlives the track a little in case the end event is lost.
NOW_PLAYING_SLACK = timedelta(seconds=90)


def counts_as_play(ms_played: int, duration_ms: int) -> bool:
    return ms_played >= PLAY_MIN_MS or (duration_ms > 0 and ms_played * 2 >= duration_ms)


async def ingest(
    session: AsyncSession, redis: Redis, user: User, device_id: object, body: EventsIn
) -> EventsOut:
    if read_settings(user).privacy.private_session:
        # Private session: nothing about this listening is stored.
        return EventsOut(accepted=0, duplicates=0, counted_plays=0)
    track_ids = {e.track_id for e in body.events}
    durations = dict(
        (await session.execute(select(Track.id, Track.duration_ms).where(Track.id.in_(track_ids)))).all()
    )
    accepted = duplicates = counted_total = 0
    plays_per_track: dict[object, int] = {}
    now = datetime.now(UTC)

    for event in body.events:
        duration = durations.get(event.track_id)
        if duration is None:
            continue
        if event.type == "play_start":
            entry = {
                "user_id": str(user.id),
                "display_name": user.display_name,
                "track_id": str(event.track_id),
                "started_at": (event.at or now).isoformat(),
            }
            ttl = int(timedelta(milliseconds=duration).total_seconds() + NOW_PLAYING_SLACK.total_seconds())
            await redis.set(f"{NOW_PLAYING_PREFIX}{user.id}", json.dumps(entry), ex=ttl)
            accepted += 1
            continue
        counted = counts_as_play(event.ms_played, duration)
        result = await session.execute(
            insert(ListeningHistory)
            .values(
                event_id=event.event_id,
                user_id=user.id,
                track_id=event.track_id,
                played_at=min(event.at or now, now),
                ms_played=event.ms_played,
                counted=counted,
                context_type=event.context_type,
                context_id=event.context_id,
                device_id=device_id,
            )
            .on_conflict_do_nothing(index_elements=["event_id"])
            .returning(ListeningHistory.id)
        )
        if result.scalar() is None:
            duplicates += 1
            continue
        accepted += 1
        if counted:
            counted_total += 1
            plays_per_track[event.track_id] = plays_per_track.get(event.track_id, 0) + 1
        await redis.delete(f"{NOW_PLAYING_PREFIX}{user.id}")

    for track_id, n in plays_per_track.items():
        await session.execute(
            update(Track).where(Track.id == track_id).values(play_count=Track.play_count + n)
        )
    await session.commit()
    return EventsOut(accepted=accepted, duplicates=duplicates, counted_plays=counted_total)
