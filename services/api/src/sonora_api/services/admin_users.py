"""User management and the dashboards (overview, streaming)."""

import json
import uuid
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import Date, cast, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, ForbiddenError, NotFoundError
from sonora_api.models import Artist, Device, ListeningHistory, Playlist, Release, Track, UploadJob, User
from sonora_api.models.enums import ReleaseStatus, TrackStatus, UserRole
from sonora_api.schemas.admin_users import (
    AdminUserPatch,
    AdminUserRow,
    DailyPlays,
    ListeningNow,
    StatsOut,
    StreamingOut,
    TopTrack,
)
from sonora_api.services import auth as auth_service
from sonora_api.services import catalog

NOW_PLAYING_PREFIX = "now:"


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


async def list_users(
    session: AsyncSession,
    *,
    q: str | None,
    role: UserRole | None,
    blocked: bool | None,
    offset: int,
    limit: int = 50,
) -> tuple[list[AdminUserRow], int]:
    devices = (
        select(Device.user_id, func.count().label("n"), func.max(Device.last_seen_at).label("seen"))
        .group_by(Device.user_id)
        .subquery()
    )
    plays = (
        select(ListeningHistory.user_id, func.count().label("n"))
        .where(ListeningHistory.counted)
        .group_by(ListeningHistory.user_id)
        .subquery()
    )
    query = (
        select(User, func.coalesce(devices.c.n, 0), devices.c.seen, func.coalesce(plays.c.n, 0))
        .outerjoin(devices, devices.c.user_id == User.id)
        .outerjoin(plays, plays.c.user_id == User.id)
    )
    count = select(func.count()).select_from(User)
    filters = []
    if q:
        filters.append(or_(User.email.ilike(_like(q)), User.display_name.ilike(_like(q))))
    if role:
        filters.append(User.role == role)
    if blocked is not None:
        filters.append(User.blocked_at.is_not(None) if blocked else User.blocked_at.is_(None))
    for f in filters:
        query, count = query.where(f), count.where(f)
    rows = await session.execute(query.order_by(User.created_at.desc(), User.id).offset(offset).limit(limit))
    out = [
        AdminUserRow(
            id=u.id, email=u.email, display_name=u.display_name, role=u.role,
            email_verified=u.email_verified_at is not None, created_at=u.created_at,
            blocked_at=u.blocked_at, block_reason=u.block_reason,
            devices=int(n_dev), last_seen_at=seen, plays=int(n_plays),
        )
        for u, n_dev, seen, n_plays in rows
    ]  # fmt: skip
    return out, int(await session.scalar(count) or 0)


async def _user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    return user


async def _guard_last_admin(session: AsyncSession, user: User) -> None:
    if user.role != UserRole.ADMIN:
        return
    admins = await session.scalar(
        select(func.count()).select_from(User).where(User.role == UserRole.ADMIN, User.blocked_at.is_(None))
    )
    if (admins or 0) <= 1:
        raise AppError("This is the last active administrator", code="last_admin", status_code=409)


async def update_user(
    session: AsyncSession,
    redis: Redis,
    settings: Settings,
    actor: User,
    user_id: uuid.UUID,
    body: AdminUserPatch,
) -> AdminUserRow:
    user = await _user(session, user_id)
    changes = body.model_dump(exclude_unset=True)
    if user.id == actor.id and (changes.get("blocked") or changes.get("role") == UserRole.USER):
        raise ForbiddenError("You can't block or demote yourself", code="self_action")
    if changes.get("display_name"):
        user.display_name = changes["display_name"].strip()
    if changes.get("role") and changes["role"] != user.role:
        if changes["role"] == UserRole.USER:
            await _guard_last_admin(session, user)
        user.role = changes["role"]
    sign_out = False
    if "blocked" in changes and changes["blocked"] is not None:
        if changes["blocked"] and user.blocked_at is None:
            await _guard_last_admin(session, user)
            user.blocked_at = datetime.now(UTC)
            user.block_reason = changes.get("block_reason") or None
            sign_out = True
        elif not changes["blocked"]:
            user.blocked_at, user.block_reason = None, None
    elif "block_reason" in changes and user.blocked_at is not None:
        user.block_reason = changes["block_reason"] or None
    await session.commit()
    if sign_out:
        await auth_service.sign_out_everywhere(session, redis, settings, user.id)
    rows, _ = await list_users(session, q=user.email, role=None, blocked=None, offset=0, limit=1)
    return rows[0]


async def sign_out_user(session: AsyncSession, redis: Redis, settings: Settings, user_id: uuid.UUID) -> int:
    await _user(session, user_id)
    return await auth_service.sign_out_everywhere(session, redis, settings, user_id)


async def delete_user(
    session: AsyncSession, redis: Redis, settings: Settings, actor: User, user_id: uuid.UUID
) -> None:
    user = await _user(session, user_id)
    if user.id == actor.id:
        raise ForbiddenError("You can't delete your own account here", code="self_action")
    await _guard_last_admin(session, user)
    await auth_service.sign_out_everywhere(session, redis, settings, user.id)
    await session.delete(user)
    await session.commit()


# ---------------------------------------------------------------------------
# Dashboards
# ---------------------------------------------------------------------------


async def now_playing(redis: Redis) -> list[dict[str, str]]:
    """Live sessions reported by players (`play_start` events), expiring on their own."""
    out = []
    async for key in redis.scan_iter(match=f"{NOW_PLAYING_PREFIX}*", count=500):
        raw = await redis.get(key)
        if raw:
            out.append(json.loads(raw))
    return sorted(out, key=lambda e: e["started_at"], reverse=True)


async def stats(session: AsyncSession, redis: Redis) -> StatsOut:
    now = datetime.now(UTC)
    day_ago, week_ago = now - timedelta(days=1), now - timedelta(days=7)

    async def count(query: object) -> int:
        return int(await session.scalar(query) or 0)  # type: ignore[call-overload]

    jobs = {
        status.value: n
        for status, n in await session.execute(
            select(UploadJob.status, func.count()).group_by(UploadJob.status)
        )
    }
    plays = select(func.count()).select_from(ListeningHistory).where(ListeningHistory.counted)
    return StatsOut(
        users=await count(select(func.count()).select_from(User)),
        users_today=await count(select(func.count()).select_from(User).where(User.created_at >= day_ago)),
        blocked_users=await count(select(func.count()).select_from(User).where(User.blocked_at.is_not(None))),
        tracks_ready=await count(
            select(func.count()).select_from(Track).where(Track.status == TrackStatus.READY)
        ),
        tracks_processing=await count(
            select(func.count()).select_from(Track).where(Track.status == TrackStatus.PROCESSING)
        ),
        releases_published=await count(
            select(func.count()).select_from(Release).where(Release.status == ReleaseStatus.PUBLISHED)
        ),
        releases_draft=await count(
            select(func.count()).select_from(Release).where(Release.status == ReleaseStatus.DRAFT)
        ),
        artists=await count(select(func.count()).select_from(Artist)),
        playlists=await count(select(func.count()).select_from(Playlist)),
        plays_today=await count(plays.where(ListeningHistory.played_at >= day_ago)),
        plays_7d=await count(plays.where(ListeningHistory.played_at >= week_ago)),
        listening_now=len(await now_playing(redis)),
        jobs=jobs,
    )


async def streaming(session: AsyncSession, redis: Redis, settings: Settings) -> StreamingOut:
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    live = await now_playing(redis)
    track_ids = [uuid.UUID(e["track_id"]) for e in live]
    tracks = {t.id: t for t in await catalog.get_tracks(session, settings, track_ids, None)}
    listening = [
        ListeningNow(
            user_id=uuid.UUID(e["user_id"]), display_name=e["display_name"],
            track=tracks[uuid.UUID(e["track_id"])], started_at=datetime.fromisoformat(e["started_at"]),
        )
        for e in live
        if uuid.UUID(e["track_id"]) in tracks
    ]  # fmt: skip

    counted = ListeningHistory.counted
    plays_today = await session.scalar(
        select(func.count())
        .select_from(ListeningHistory)
        .where(counted, ListeningHistory.played_at >= now - timedelta(days=1))
    )
    plays_7d, listeners_7d = (
        await session.execute(
            select(func.count(), func.count(distinct(ListeningHistory.user_id))).where(
                counted, ListeningHistory.played_at >= week_ago
            )
        )
    ).one()
    day = cast(func.timezone("UTC", ListeningHistory.played_at), Date)
    daily_rows = await session.execute(
        select(day, func.count(), func.count(distinct(ListeningHistory.user_id)))
        .where(counted, ListeningHistory.played_at >= now - timedelta(days=14))
        .group_by(day)
        .order_by(day)
    )
    by_day = {d.isoformat(): (int(p), int(lst)) for d, p, lst in daily_rows}
    daily = []
    for offset in range(13, -1, -1):
        d = (now - timedelta(days=offset)).date().isoformat()
        p, lst = by_day.get(d, (0, 0))
        daily.append(DailyPlays(day=d, plays=p, listeners=lst))

    top_rows = list(
        await session.execute(
            select(ListeningHistory.track_id, func.count().label("n"))
            .where(counted, ListeningHistory.played_at >= week_ago)
            .group_by(ListeningHistory.track_id)
            .order_by(func.count().desc())
            .limit(10)
        )
    )
    top_tracks = {
        t.id: t for t in await catalog.get_tracks(session, settings, [r.track_id for r in top_rows], None)
    }
    return StreamingOut(
        listening_now=listening,
        plays_today=int(plays_today or 0),
        plays_7d=int(plays_7d or 0),
        listeners_7d=int(listeners_7d or 0),
        daily=daily,
        top_tracks=[
            TopTrack(track=top_tracks[r.track_id], plays=int(r.n))
            for r in top_rows
            if r.track_id in top_tracks
        ],
    )
