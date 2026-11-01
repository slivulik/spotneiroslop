"""Recommendations from SONORA's own data: listening history (recency-weighted), likes and
follows, track genres and co-listening ("people who played X also played Y").

No external signals and no invented numbers: with an empty history the wave falls back to what
is popular and new on the service. Everything is computed per request with a handful of
aggregate queries, which is plenty at single-server scale.
"""

from __future__ import annotations

import math
import random
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sonora_api.core.config import Settings
from sonora_api.core.errors import NotFoundError
from sonora_api.models import (
    Artist,
    FollowArtist,
    Genre,
    LikeTrack,
    ListeningHistory,
    Release,
    Track,
    TrackArtist,
    TrackGenre,
)
from sonora_api.models.enums import ArtistRole, TrackStatus
from sonora_api.models.users import User
from sonora_api.schemas.catalog import Artwork, GenreRef, TrackOut
from sonora_api.schemas.editorial import ArtistSummary
from sonora_api.schemas.recommend import ArtistStatsOut, MixOut, MixSummary, WeeklyPlays
from sonora_api.services import catalog, editorial

PERFORMER = (ArtistRole.MAIN, ArtistRole.FEAT)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Taste:
    artists: dict[uuid.UUID, float] = field(default_factory=dict)
    genres: dict[uuid.UUID, float] = field(default_factory=dict)
    #: Track → affinity weight (seeds for co-listening).
    tracks: dict[uuid.UUID, float] = field(default_factory=dict)
    recent: set[uuid.UUID] = field(default_factory=set)

    @property
    def empty(self) -> bool:
        return not self.artists and not self.genres


async def taste(session: AsyncSession, user: User) -> Taste:
    """Recency-weighted plays (90 days, half-weight every two weeks), likes ×3, follows ×5."""
    now = _now()
    t = Taste()
    plays = await session.execute(
        select(ListeningHistory.track_id, ListeningHistory.played_at, ListeningHistory.counted).where(
            ListeningHistory.user_id == user.id, ListeningHistory.played_at >= now - timedelta(days=90)
        )
    )
    for track_id, played_at, counted in plays:
        days = (now - played_at).total_seconds() / 86_400
        if days < 7:
            t.recent.add(track_id)
        if counted:
            t.tracks[track_id] = t.tracks.get(track_id, 0) + 1 / (1 + days / 14)
    for (track_id,) in await session.execute(select(LikeTrack.track_id).where(LikeTrack.user_id == user.id)):
        t.tracks[track_id] = t.tracks.get(track_id, 0) + 3
    if t.tracks:
        ids = list(t.tracks)
        for track_id, artist_id in await session.execute(
            select(TrackArtist.track_id, TrackArtist.artist_id).where(
                TrackArtist.track_id.in_(ids), TrackArtist.role.in_(PERFORMER)
            )
        ):
            t.artists[artist_id] = t.artists.get(artist_id, 0) + t.tracks[track_id]
        for track_id, genre_id, weight in await session.execute(
            select(TrackGenre.track_id, TrackGenre.genre_id, TrackGenre.weight).where(
                TrackGenre.track_id.in_(ids)
            )
        ):
            t.genres[genre_id] = t.genres.get(genre_id, 0) + t.tracks[track_id] * weight
    for (artist_id,) in await session.execute(
        select(FollowArtist.artist_id).where(FollowArtist.user_id == user.id)
    ):
        t.artists[artist_id] = t.artists.get(artist_id, 0) + 5
    return t


def _top[K](scores: dict[K, float], n: int) -> list[K]:
    return [k for k, _ in sorted(scores.items(), key=lambda kv: -kv[1])[:n]]


def _norm(d: dict[uuid.UUID, float]) -> dict[uuid.UUID, float]:
    top = max(d.values(), default=0)
    return {k: v / top for k, v in d.items()} if top else {}


async def _co_listened(
    session: AsyncSession, user: User, seeds: list[uuid.UUID], limit: int = 300
) -> Counter[uuid.UUID]:
    """Tracks other listeners played alongside the seeds (last 180 days)."""
    if not seeds:
        return Counter()
    since = _now() - timedelta(days=180)
    peers = (
        select(ListeningHistory.user_id)
        .where(
            ListeningHistory.track_id.in_(seeds),
            ListeningHistory.counted,
            ListeningHistory.user_id != user.id,
            ListeningHistory.played_at >= since,
        )
        .distinct()
        .limit(500)
        .scalar_subquery()
    )
    rows = await session.execute(
        select(ListeningHistory.track_id, func.count(func.distinct(ListeningHistory.user_id)))
        .where(
            ListeningHistory.user_id.in_(peers), ListeningHistory.counted, ListeningHistory.played_at >= since
        )
        .group_by(ListeningHistory.track_id)
        .order_by(func.count(func.distinct(ListeningHistory.user_id)).desc())
        .limit(limit)
    )
    return Counter({tid: n for tid, n in rows})  # noqa: C416 - Row unpacking


@dataclass
class _Cand:
    track: Track
    artists: list[uuid.UUID]
    genres: list[uuid.UUID]


async def _load(session: AsyncSession, ids: set[uuid.UUID]) -> list[_Cand]:
    if not ids:
        return []
    tracks = list(await session.scalars(catalog._tracks_query(_now()).where(Track.id.in_(ids))))
    artists: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for tid, aid in await session.execute(
        select(TrackArtist.track_id, TrackArtist.artist_id)
        .where(TrackArtist.track_id.in_(ids), TrackArtist.role.in_(PERFORMER))
        .order_by(TrackArtist.position)
    ):
        artists[tid].append(aid)
    genres: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for tid, gid in await session.execute(
        select(TrackGenre.track_id, TrackGenre.genre_id).where(TrackGenre.track_id.in_(ids))
    ):
        genres[tid].append(gid)
    return [_Cand(t, artists[t.id], genres[t.id]) for t in tracks]


async def _candidate_ids(
    session: AsyncSession, t: Taste, user: User, cooc: Counter[uuid.UUID]
) -> set[uuid.UUID]:
    ids: set[uuid.UUID] = set(cooc)
    if t.artists:
        ids |= set(
            await session.scalars(
                select(TrackArtist.track_id)
                .where(TrackArtist.artist_id.in_(_top(t.artists, 15)), TrackArtist.role.in_(PERFORMER))
                .limit(400)
            )
        )
    if t.genres:
        ids |= set(
            await session.scalars(
                select(TrackGenre.track_id).where(TrackGenre.genre_id.in_(_top(t.genres, 6))).limit(400)
            )
        )
    # Always mix in what's popular and new so the wave can surprise.
    ids |= set(
        await session.scalars(
            select(Track.id)
            .where(Track.status == TrackStatus.READY)
            .order_by(Track.play_count.desc())
            .limit(80)
        )
    )
    ids |= set(
        await session.scalars(
            select(Track.id)
            .where(Track.status == TrackStatus.READY)
            .order_by(Track.created_at.desc())
            .limit(40)
        )
    )
    return ids


def _rank(
    cands: list[_Cand], t: Taste, cooc: Counter[uuid.UUID], rng: random.Random, exclude: set[uuid.UUID]
) -> list[_Cand]:
    a, g, c = _norm(t.artists), _norm(t.genres), _norm(dict(cooc))
    top_pc = max((x.track.play_count for x in cands), default=0)
    now = _now()
    scored: list[tuple[float, _Cand]] = []
    for x in cands:
        if x.track.id in exclude:
            continue
        s = 2.0 * max((a.get(i, 0) for i in x.artists), default=0)
        s += 1.5 * min(1.0, sum(g.get(i, 0) for i in x.genres))
        s += 2.5 * c.get(x.track.id, 0)
        s += 0.6 * (math.log1p(x.track.play_count) / math.log1p(top_pc) if top_pc else 0)
        s += 0.3 if (now - x.track.created_at).days < 60 else 0
        s -= 1.5 if x.track.id in t.recent else 0
        s += rng.random() * 0.45
        scored.append((s, x))
    scored.sort(key=lambda p: -p[0])
    return [x for _, x in scored]


def _diversify(ranked: list[_Cand], limit: int, per_artist: int = 2) -> list[_Cand]:
    out: list[_Cand] = []
    count: Counter[uuid.UUID] = Counter()
    for x in ranked:
        main = x.artists[0] if x.artists else None
        if main and count[main] >= per_artist:
            continue
        if out and out[-1].track.release_id == x.track.release_id:
            continue
        out.append(x)
        if main:
            count[main] += 1
        if len(out) >= limit:
            break
    if len(out) < limit:  # small catalogues: relax diversity rather than come up short
        out += [x for x in ranked if x not in out][: limit - len(out)]
    return out


async def wave(
    session: AsyncSession, settings: Settings, user: User, limit: int, exclude: set[uuid.UUID]
) -> list[TrackOut]:
    """The next batch of "Моя волна": endless, personal, never repeating the session's tracks."""
    t = await taste(session, user)
    cooc = await _co_listened(session, user, _top(t.tracks, 20))
    cands = await _load(session, await _candidate_ids(session, t, user, cooc))
    ranked = _rank(cands, t, cooc, random.Random(), exclude)  # noqa: S311 - shuffling, not security
    return [catalog.track_out(settings, x.track, user) for x in _diversify(ranked, limit)]


# ---------------------------------------------------------------------------
# Daily mixes
# ---------------------------------------------------------------------------

MIX_SIZE = 30


async def _mix_defs(session: AsyncSession, t: Taste) -> list[tuple[str, str, str]]:
    """(key, title, subtitle) for today's mixes: top genres, top artists, discoveries."""
    defs: list[tuple[str, str, str]] = []
    genre_ids = _top(t.genres, 3)
    if not genre_ids:  # cold start: the genres with the most music
        genre_ids = list(
            await session.scalars(
                select(TrackGenre.genre_id)
                .group_by(TrackGenre.genre_id)
                .order_by(func.count().desc())
                .limit(2)
            )
        )
    names = dict((await session.execute(select(Genre.id, Genre.name).where(Genre.id.in_(genre_ids)))).all())
    defs += [
        (f"genre:{gid}", f"Микс: {names[gid]}", "Под ваш вкус в этом жанре")
        for gid in genre_ids
        if gid in names
    ]
    artist_ids = _top(t.artists, 2)
    artists = dict(
        (await session.execute(select(Artist.id, Artist.name).where(Artist.id.in_(artist_ids)))).all()
    )
    defs += [
        (f"artist:{aid}", f"{artists[aid]} и похожие", "Любимый артист и то, что слушают рядом")
        for aid in artist_ids
        if aid in artists
    ]
    if t.tracks:
        defs.append(("discover", "Открытия", "Треки, которых вы ещё не слышали"))
    return defs


async def _mix_tracks(session: AsyncSession, user: User, t: Taste, key: str) -> list[_Cand]:
    day = _now().date().isoformat()
    rng = random.Random(f"{user.id}:{day}:{key}")  # noqa: S311 - stable shuffle for the day
    cooc = await _co_listened(session, user, _top(t.tracks, 20))
    kind, _, ident = key.partition(":")
    if kind == "genre":
        gid = uuid.UUID(ident)
        ids = set(
            await session.scalars(select(TrackGenre.track_id).where(TrackGenre.genre_id == gid).limit(500))
        )
        cands = await _load(session, ids)
        boosted = Taste(
            artists=t.artists,
            genres={**t.genres, gid: max(t.genres.values(), default=1) * 2},
            tracks=t.tracks,
            recent=t.recent,
        )
        return _diversify(_rank(cands, boosted, cooc, rng, set()), MIX_SIZE)
    if kind == "artist":
        aid = uuid.UUID(ident)
        own = set(
            await session.scalars(
                select(TrackArtist.track_id).where(
                    TrackArtist.artist_id == aid, TrackArtist.role.in_(PERFORMER)
                )
            )
        )
        near = await _co_listened(session, user, list(own))
        cands = await _load(session, own | set(list(near)[:200]))
        boosted = Taste(
            artists={**t.artists, aid: max(t.artists.values(), default=1) * 1.5},
            genres=t.genres,
            tracks=t.tracks,
            recent=t.recent,
        )
        return _diversify(_rank(cands, boosted, near + cooc, rng, set()), MIX_SIZE, per_artist=6)
    if kind == "discover":
        heard = set(
            await session.scalars(
                select(ListeningHistory.track_id).where(ListeningHistory.user_id == user.id).distinct()
            )
        )
        cands = await _load(session, (await _candidate_ids(session, t, user, cooc)) - heard)
        return _diversify(_rank(cands, t, cooc, rng, heard), MIX_SIZE)
    raise NotFoundError("Mix not found")


async def mixes(session: AsyncSession, settings: Settings, user: User) -> list[MixSummary]:
    t = await taste(session, user)
    out: list[MixSummary] = []
    for key, title, subtitle in await _mix_defs(session, t):
        tracks = await _mix_tracks(session, user, t, key)
        if len(tracks) < 3:
            continue
        covers: list[Artwork] = []
        for x in tracks:
            art = catalog.track_out(settings, x.track, user).release.artwork
            if art and all(c.url_template != art.url_template for c in covers):
                covers.append(art)
            if len(covers) == 4:
                break
        out.append(
            MixSummary(key=key, title=title, subtitle=subtitle, mosaic=covers, track_count=len(tracks))
        )
    return out


async def mix(session: AsyncSession, settings: Settings, user: User, key: str) -> MixOut:
    t = await taste(session, user)
    defs = {k: (title, sub) for k, title, sub in await _mix_defs(session, t)}
    if key not in defs:
        raise NotFoundError("Mix not found")
    tracks = [catalog.track_out(settings, x.track, user) for x in await _mix_tracks(session, user, t, key)]
    title, subtitle = defs[key]
    return MixOut(key=key, title=title, subtitle=subtitle, tracks=tracks)


# ---------------------------------------------------------------------------
# Artists
# ---------------------------------------------------------------------------


async def top_artists(
    session: AsyncSession, settings: Settings, user: User, limit: int
) -> list[ArtistSummary]:
    t = await taste(session, user)
    ids = _top(t.artists, limit)
    rows = {a.id: a for a in await session.scalars(select(Artist).where(Artist.id.in_(ids)))}
    return [editorial.artist_summary(settings, rows[i]) for i in ids if i in rows]


async def similar_artists(
    session: AsyncSession, settings: Settings, artist_id: uuid.UUID, limit: int
) -> list[ArtistSummary]:
    """Co-listening (listeners in common, 180 days) plus shared genres; never the artist itself."""
    if await session.get(Artist, artist_id) is None:
        raise NotFoundError("Artist not found")
    since = _now() - timedelta(days=180)
    own_tracks = select(TrackArtist.track_id).where(TrackArtist.artist_id == artist_id).scalar_subquery()
    listeners = (
        select(ListeningHistory.user_id)
        .where(
            ListeningHistory.track_id.in_(own_tracks),
            ListeningHistory.counted,
            ListeningHistory.played_at >= since,
        )
        .distinct()
        .scalar_subquery()
    )
    scores: Counter[uuid.UUID] = Counter()
    for aid, n in await session.execute(
        select(TrackArtist.artist_id, func.count(func.distinct(ListeningHistory.user_id)))
        .join(ListeningHistory, ListeningHistory.track_id == TrackArtist.track_id)
        .where(
            ListeningHistory.user_id.in_(listeners),
            ListeningHistory.counted,
            ListeningHistory.played_at >= since,
            TrackArtist.artist_id != artist_id,
            # Other tracks only: a featured guest on the artist's own songs isn't "similar".
            TrackArtist.track_id.notin_(own_tracks),
        )
        .group_by(TrackArtist.artist_id)
    ):
        scores[aid] += 2 * n
    own_genres = select(TrackGenre.genre_id).where(TrackGenre.track_id.in_(own_tracks)).scalar_subquery()
    for aid, n in await session.execute(
        select(TrackArtist.artist_id, func.count(func.distinct(TrackGenre.genre_id)))
        .join(TrackGenre, TrackGenre.track_id == TrackArtist.track_id)
        .where(
            TrackGenre.genre_id.in_(own_genres),
            TrackArtist.artist_id != artist_id,
            TrackArtist.track_id.notin_(own_tracks),
        )
        .group_by(TrackArtist.artist_id)
    ):
        scores[aid] += n
    ids = [a for a, _ in scores.most_common(limit)]
    rows = {a.id: a for a in await session.scalars(select(Artist).where(Artist.id.in_(ids)))}
    return [editorial.artist_summary(settings, rows[i]) for i in ids if i in rows]


async def monthly_listeners(session: AsyncSession, artist_id: uuid.UUID) -> int:
    since = _now() - timedelta(days=30)
    own_tracks = select(TrackArtist.track_id).where(TrackArtist.artist_id == artist_id).scalar_subquery()
    return (
        await session.scalar(
            select(func.count(func.distinct(ListeningHistory.user_id))).where(
                ListeningHistory.track_id.in_(own_tracks),
                ListeningHistory.counted,
                ListeningHistory.played_at >= since,
            )
        )
    ) or 0


async def artist_stats(session: AsyncSession, artist_id: uuid.UUID) -> ArtistStatsOut:
    """Real numbers from SONORA's own history: listeners, plays, 12-week trend, top tracks."""
    if await session.get(Artist, artist_id) is None:
        raise NotFoundError("Artist not found")
    now = _now()
    own = (
        select(TrackArtist.track_id)
        .where(TrackArtist.artist_id == artist_id, TrackArtist.role.in_(PERFORMER))
        .scalar_subquery()
    )
    counted = ListeningHistory.track_id.in_(own) & ListeningHistory.counted
    plays_30d = (
        await session.scalar(
            select(func.count()).where(counted, ListeningHistory.played_at >= now - timedelta(days=30))
        )
        or 0
    )
    total = (
        await session.scalar(select(func.coalesce(func.sum(Track.play_count), 0)).where(Track.id.in_(own)))
        or 0
    )
    week = func.date_trunc("week", ListeningHistory.played_at)
    per_week = {
        w.date().isoformat(): n
        for w, n in await session.execute(
            select(week, func.count())
            .where(counted, ListeningHistory.played_at >= now - timedelta(weeks=12))
            .group_by(week)
        )
    }
    monday = (now - timedelta(days=now.weekday())).date()
    weekly = [
        WeeklyPlays(
            week=(monday - timedelta(weeks=i)).isoformat(),
            plays=per_week.get((monday - timedelta(weeks=i)).isoformat(), 0),
        )
        for i in range(11, -1, -1)
    ]
    first = await session.scalar(
        select(func.min(Release.release_date))
        .join(Track, Track.release_id == Release.id)
        .where(Track.id.in_(own))
    )
    genre_rows = await session.execute(
        select(Genre.id, Genre.slug, Genre.name)
        .join(TrackGenre, TrackGenre.genre_id == Genre.id)
        .where(TrackGenre.track_id.in_(own))
        .group_by(Genre.id, Genre.slug, Genre.name)
        .order_by(func.count().desc(), Genre.name)
        .limit(5)
    )
    return ArtistStatsOut(
        genres=[GenreRef(id=i, slug=sl, name=n) for i, sl, n in genre_rows],
        monthly_listeners=await monthly_listeners(session, artist_id),
        plays_30d=plays_30d,
        total_plays=int(total),
        weekly=weekly,
        first_release=first.isoformat() if first else None,
    )
