"""Wave 2.0: «Моя волна» as a listening session that adapts while it plays.

A session (`wave_sessions` row) remembers how it was started — the personal wave or a radio from
a track/artist — and the listener's settings (character, mood, language). What changes from track
to track lives in Redis for ~12 hours: the ids already served, so `next` never repeats itself,
and per-artist/per-genre nudges from feedback (an early skip pushes the artist down, a like pulls
similar music up). Ranking is the one behind `GET /v1/me/wave` (`services.recommend`); settings
add filters and score terms on top. Filters relax — language, then mood, then character — rather
than ever answer with an empty batch while something playable is left.

Signals are whatever the catalogue has: audio features and mood tags when the analyser filled
them, otherwise lyrics, genre names and the alphabet of titles and artist names. A track nothing
is known about stays neutral: it is neither preferred nor filtered out by mood.
"""

from __future__ import annotations

import asyncio
import random
import re
import uuid
from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy import ColumnElement, Text, cast, delete, func, not_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from sonora_api.core.config import Settings
from sonora_api.core.errors import NotFoundError
from sonora_api.core.ids import uuid7
from sonora_api.models import (
    Artist,
    Dislike,
    Genre,
    LikeTrack,
    ListeningHistory,
    Lyrics,
    Mood,
    Track,
    TrackArtist,
    TrackFeatures,
    TrackGenre,
    TrackMood,
    WaveSession,
)
from sonora_api.models.users import User
from sonora_api.schemas.catalog import TrackOut
from sonora_api.schemas.recommend import (
    WaveFeedbackIn,
    WaveLanguage,
    WaveMood,
    WaveSessionOut,
    WaveSettings,
    WaveStartIn,
)
from sonora_api.services import catalog, library
from sonora_api.services import recommend as rec

#: Served ids and feedback nudges outlive the last request by this much.
STATE_TTL = timedelta(hours=12)
#: Longest served list kept per session (~5 days of non-stop listening).
SERVED_CAP = 2000
#: Once nothing new is left, tracks served in the last N may not come back yet. Tiny catalogues
#: shrink the window step by step instead of answering with an empty batch.
REPEAT_WINDOWS = (30, 10, 1, 0)
#: Look beyond the usual candidates when fewer than `limit × WIDEN_FACTOR` are left.
WIDEN_FACTOR = 3
WIDEN_POOL = 300
EARLY_SKIP_MS = 30_000
#: A batch is computed under a short per-session lock so that two `next` calls racing each other
#: cannot both hand out the same tracks.
LOCK_TTL_MS = 10_000
LOCK_ATTEMPTS = 50
LOCK_POLL_S = 0.1

#: Session nudges per feedback, (each performing artist, each genre). For scale: the base ranking
#: gives up to 2.0 for a favourite artist and 1.5 for matching genres (`recommend._score`).
_NUDGES: dict[str, tuple[float, float]] = {
    "finished": (0.4, 0.2),
    "skipped": (-1.5, -0.5),  # early skips only (see EARLY_SKIP_MS)
    "liked": (1.2, 0.6),
    "disliked": (-3.0, -0.5),
}
#: Bounds of the summed nudge on one track, so a long session can't bury or crown it for good.
NUDGE_RANGE = (-5.0, 3.0)
#: Mood fit (−1…1) below this filters a track out while the mood filter is in force.
MOOD_TOLERANCE = -0.25
MOOD_WEIGHT = 1.5
LANGUAGE_WEIGHT = 1.0

_SEED_ARTIST = "seed_artist"  # stored next to the settings when a radio has both seeds
_CYRILLIC = "[\u0400-\u04ff]"  # the Cyrillic block (Russian, Ukrainian, Belarusian, …)
_CYRILLIC_RE = re.compile(_CYRILLIC)

# --- Heuristics ------------------------------------------------------------------------------
# Keywords are matched against lower-cased names whose punctuation became spaces ("Hip-Hop" →
# "hip hop", «Пост-рок» → «пост рок»): a plain keyword must be a whole word ("emo" doesn't match
# "demo"), "stem*" is a word prefix ("electro*" matches "electronic", «бодр*» matches «бодрое»),
# and a keyword with a space is a phrase.

# fmt: off
#: Genre name → mood, used only when a track has neither audio features nor mood tags.
_MOOD_GENRES: dict[WaveMood, tuple[str, ...]] = {
    "energetic": (
        "rock", "рок", "metal*", "метал*", "punk*", "панк*", "drum*", "dnb", "techno", "техно",
        "house", "хаус", "edm", "electro*", "электро*", "dance*", "дэнс", "trance", "транс",
        "hardstyle", "hardcore", "industrial", "dubstep", "trap", "трэп", "hip hop", "хип хоп",
        "rap", "рэп", "phonk", "фонк", "grime", "jungle",
    ),
    "happy": (
        "pop", "поп", "synthpop", "disco*", "диско", "funk*", "фанк", "reggae*", "регги", "ska",
        "ска", "latin*", "латин*", "swing", "свинг", "eurobeat", "schlager", "эстрад*",
    ),
    "calm": (
        "ambient*", "эмбиент*", "chill*", "чилл*", "lo fi", "lofi", "лоу фай", "classical",
        "классическ*", "acoustic*", "акустик*", "new age", "downtempo", "piano*", "фортепиан*",
        "jazz*", "джаз*", "bossa*", "босса*", "meditat*", "медитац*", "sleep*", "soundtrack*",
    ),
    "sad": (
        "blues*", "блюз*", "emo", "эмо", "doom*", "slowcore", "sadcore", "darkwave", "post rock",
        "пост рок", "shoegaze", "шугейз", "melanchol*", "меланхол*", "ballad*", "баллад*", "sad*",
        "gothic", "готик*",
    ),
}
#: Mood tag (`moods.slug` / `moods.name`, from editors or the analyser) → mood.
_MOOD_TAGS: dict[WaveMood, tuple[str, ...]] = {
    "energetic": (
        "energ*", "энерг*", "бодр*", "drive*", "драйв*", "workout*", "трениров*", "sport*",
        "спорт*", "party", "вечеринк*", "upbeat", "power*", "мощн*",
    ),
    "happy": (
        "happy", "весел*", "радост*", "joy*", "fun", "funny", "позитив*", "positive", "summer",
        "летн*", "sunny", "солнеч*", "uplift*",
    ),
    "calm": (
        "calm*", "спокойн*", "relax*", "расслаб*", "chill*", "чилл*", "sleep*", "сон", "focus*",
        "фокус*", "meditat*", "медитац*", "peace*", "умиротвор*", "romantic*", "романт*",
    ),
    "sad": (
        "sad*", "грус*", "печал*", "melanchol*", "меланхол*", "lonely", "одинок*", "heartbreak*",
        "rain", "rainy", "дожд*", "тоск*", "dark*", "мрачн*",
    ),
}
#: Genres that are (nearly always) without vocals — «Без слов».
_INSTRUMENTAL_GENRES = (
    "instrumental*", "инструментал*", "ambient*", "эмбиент*", "classical", "классическ*",
    "orchestr*", "оркестр*", "soundtrack*", "саундтрек*", "score", "piano*", "фортепиан*", "lo fi",
    "lofi", "chillhop", "post rock", "пост рок",
)
# fmt: on
_OPPOSITE: dict[WaveMood, WaveMood] = {
    "energetic": "calm",
    "calm": "energetic",
    "happy": "sad",
    "sad": "happy",
}
#: ISO 639 codes for "no linguistic content" (and what analysers write for it) …
_NO_LANGUAGE = ("zxx", "none", "instrumental")
#: … and for "can't tell": these say nothing about the language.
_UNKNOWN_LANGUAGE = ("und", "mul", "mis")
INSTRUMENTAL_MIN = 0.6


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def start(
    session: AsyncSession, redis: Redis, settings: Settings, user: User, body: WaveStartIn
) -> WaveSessionOut:
    """Open a session with the listener's settings and hand out its first batch."""
    await _check_seeds(session, body.seed_track, body.seed_artist)
    stored: dict[str, Any] = body.settings.model_dump(mode="json")
    if body.seed_track and body.seed_artist:
        stored[_SEED_ARTIST] = str(body.seed_artist)
    seed_type = "track" if body.seed_track else "artist" if body.seed_artist else "user"
    row = WaveSession(
        id=uuid7(),
        user_id=user.id,
        seed_type=seed_type,
        seed_id=body.seed_track or body.seed_artist,
        settings=stored,
    )
    session.add(row)
    await session.flush()
    tracks = await _serve(session, redis, settings, user, row, body.limit)
    await session.commit()
    return WaveSessionOut(session_id=row.id, settings=body.settings, tracks=tracks)


async def next_batch(
    session: AsyncSession, redis: Redis, settings: Settings, user: User, session_id: uuid.UUID, limit: int
) -> list[TrackOut]:
    """The next batch of one of the listener's sessions (404 for anyone else's)."""
    return await _serve(session, redis, settings, user, await _own(session, user, session_id), limit)


async def feedback(
    session: AsyncSession, redis: Redis, user: User, session_id: uuid.UUID, body: WaveFeedbackIn
) -> None:
    """Apply what the listener did with a track to the rest of the session (and to their library
    for likes and dislikes)."""
    row = await _own(session, user, session_id)
    if await session.get(Track, body.track_id) is None:
        raise NotFoundError("Track not found")
    deltas: dict[str, float] = {}
    if body.action == "liked":
        # A like overrides an earlier «не нравится» of the same track.
        await session.execute(
            delete(Dislike).where(Dislike.user_id == user.id, Dislike.track_id == body.track_id)
        )
        await library.set_saved(session, user, "tracks", body.track_id, saved=True)
        deltas[_liked_key(body.track_id)] = 1.0  # co-listening seed for the rest of the session
    elif body.action == "disliked":
        await session.execute(
            insert(Dislike)
            .values(id=uuid7(), user_id=user.id, track_id=body.track_id)
            # Disliking again renews an expired dislike instead of failing on the unique index.
            .on_conflict_do_update(
                index_elements=["user_id", "track_id"],
                index_where=Dislike.track_id.is_not(None),
                set_={"until": None},
            )
        )
    # A skip without a position counts as early: nothing says the listener gave the track a chance.
    early_skip = body.action == "skipped" and (body.played_ms is None or body.played_ms < EARLY_SKIP_MS)
    if body.action in ("finished", "liked", "disliked") or early_skip:
        artist_delta, genre_delta = _NUDGES[body.action]
        artists = await session.scalars(
            select(TrackArtist.artist_id).where(
                TrackArtist.track_id == body.track_id, TrackArtist.role.in_(rec.PERFORMER)
            )
        )
        for aid in artists:
            deltas[f"a:{aid}"] = deltas.get(f"a:{aid}", 0.0) + artist_delta
        for gid in await session.scalars(
            select(TrackGenre.genre_id).where(TrackGenre.track_id == body.track_id)
        ):
            deltas[f"g:{gid}"] = deltas.get(f"g:{gid}", 0.0) + genre_delta
    row.last_event_at = rec._now()
    await session.commit()
    await _nudge(redis, row.id, deltas)


async def latest_settings(session: AsyncSession, user: User) -> WaveSettings:
    """Settings of the session the listener started last (all «any» before the first one)."""
    stored = await session.scalar(
        select(WaveSession.settings)
        .where(WaveSession.user_id == user.id)
        .order_by(WaveSession.started_at.desc(), WaveSession.id.desc())
        .limit(1)
    )
    return _settings_of(stored)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


async def _check_seeds(
    session: AsyncSession, seed_track: uuid.UUID | None, seed_artist: uuid.UUID | None
) -> None:
    if seed_track:
        visible = await session.scalar(
            select(Track.id)
            .join(Track.release)
            .where(Track.id == seed_track, catalog.track_visible(rec._now()))
        )
        if visible is None:
            raise NotFoundError("Track not found")
    if seed_artist and await session.get(Artist, seed_artist) is None:
        raise NotFoundError("Artist not found")


async def _own(session: AsyncSession, user: User, session_id: uuid.UUID) -> WaveSession:
    """The listener's own session; someone else's is indistinguishable from a missing one."""
    row = await session.scalar(
        select(WaveSession).where(WaveSession.id == session_id, WaveSession.user_id == user.id)
    )
    if row is None:
        raise NotFoundError("Wave session not found")
    return row


def _settings_of(stored: dict[str, Any] | None) -> WaveSettings:
    try:
        return WaveSettings.model_validate(stored or {})
    except ValidationError:  # written by an older version with other values: start from «any»
        return WaveSettings()


def _as_uuid(value: object) -> uuid.UUID | None:
    if isinstance(value, str):
        try:
            return uuid.UUID(value)
        except ValueError:
            return None
    return None


def _seeds(row: WaveSession) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    if row.seed_type == "track":
        return row.seed_id, _as_uuid(row.settings.get(_SEED_ARTIST))
    if row.seed_type == "artist":
        return None, row.seed_id
    return None, None


async def _serve(
    session: AsyncSession, redis: Redis, settings: Settings, user: User, row: WaveSession, limit: int
) -> list[TrackOut]:
    seed_track, seed_artist = _seeds(row)
    async with _exclusive(redis, row.id):
        served = await _served(redis, row.id)
        tuning = await _tuning(redis, row.id)
        picked = await _pick(
            session, user, _settings_of(row.settings), seed_track, seed_artist, served, tuning, limit
        )
        await _remember(redis, row.id, [x.track.id for x in picked])
    return [catalog.track_out(settings, x.track, user) for x in picked]


# ---------------------------------------------------------------------------
# Session state in Redis
# ---------------------------------------------------------------------------


def _key(session_id: uuid.UUID, part: str) -> str:
    return f"wave:{session_id}:{part}"


def _liked_key(track_id: uuid.UUID) -> str:
    return f"l:{track_id}"


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


@asynccontextmanager
async def _exclusive(redis: Redis, session_id: uuid.UUID) -> AsyncIterator[None]:
    """Serialise batches of one session. If the lock can't be had in time (a crashed holder), go
    ahead anyway: a rare repeat is better than a stuck wave."""
    key, token = _key(session_id, "lock"), uuid7().hex
    acquired = False
    for _ in range(LOCK_ATTEMPTS):
        if await redis.set(key, token, nx=True, px=LOCK_TTL_MS):
            acquired = True
            break
        await asyncio.sleep(LOCK_POLL_S)
    try:
        yield
    finally:
        if acquired:
            held = await redis.get(key)
            if held is not None and _text(held) == token:
                await redis.delete(key)


async def _served(redis: Redis, session_id: uuid.UUID) -> list[uuid.UUID]:
    out: list[uuid.UUID] = []
    for raw in await redis.lrange(_key(session_id, "served"), 0, -1):
        track_id = _as_uuid(_text(raw))
        if track_id is not None:
            out.append(track_id)
    return out


async def _remember(redis: Redis, session_id: uuid.UUID, track_ids: list[uuid.UUID]) -> None:
    key = _key(session_id, "served")
    if track_ids:
        await redis.rpush(key, *[str(t) for t in track_ids])
        await redis.ltrim(key, -SERVED_CAP, -1)
    await redis.expire(key, STATE_TTL)
    await redis.expire(_key(session_id, "tune"), STATE_TTL)


async def _tuning(redis: Redis, session_id: uuid.UUID) -> dict[str, float]:
    """Accumulated feedback nudges: "a:<artist>", "g:<genre>" → score delta; "l:<track>" → liked."""
    out: dict[str, float] = {}
    for name, value in (await redis.hgetall(_key(session_id, "tune"))).items():
        try:
            out[_text(name)] = float(_text(value))
        except ValueError:
            continue
    return out


async def _nudge(redis: Redis, session_id: uuid.UUID, deltas: dict[str, float]) -> None:
    key = _key(session_id, "tune")
    for name, delta in deltas.items():
        await redis.hincrbyfloat(key, name, delta)  # atomic: concurrent feedback can't lose updates
    await redis.expire(key, STATE_TTL)
    await redis.expire(_key(session_id, "served"), STATE_TTL)


# ---------------------------------------------------------------------------
# Picking a batch
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _Signals:
    """What the mood and language settings look at, per candidate (all optional)."""

    energy: float | None = None
    valence: float | None = None
    bpm: float | None = None
    instrumentalness: float | None = None
    vocal_language: str | None = None
    has_lyrics: bool = False
    lyrics_language: str | None = None
    #: Whether the stored lyrics contain Cyrillic; None without a lyrics row.
    lyrics_cyrillic: bool | None = None
    cyrillic_names: bool = False
    mood_tags: list[str] = field(default_factory=list)
    genres: list[str] = field(default_factory=list)


@dataclass(slots=True)
class _Listener:
    """What the character setting compares against (only what the setting needs is loaded)."""

    tracks: dict[uuid.UUID, float]  # normalised affinity: likes and plays
    artists: dict[uuid.UUID, float]  # normalised affinity: likes, plays and follows
    recent: set[uuid.UUID]
    heard: set[uuid.UUID] = field(default_factory=set)
    known_artists: set[uuid.UUID] = field(default_factory=set)
    popularity: dict[uuid.UUID, float] = field(default_factory=dict)


@dataclass(slots=True)
class _Judged:
    score: float
    cand: rec._Cand
    language_ok: bool
    mood_ok: bool
    character_ok: bool

    def passes(self, level: int) -> bool:
        """Level 0 applies every filter; each next level drops one: language, mood, character."""
        if level >= 3:
            return True
        if level >= 2:
            return self.character_ok
        if level >= 1:
            return self.mood_ok and self.character_ok
        return self.language_ok and self.mood_ok and self.character_ok


async def _pick(
    session: AsyncSession,
    user: User,
    ws: WaveSettings,
    seed_track: uuid.UUID | None,
    seed_artist: uuid.UUID | None,
    served: list[uuid.UUID],
    tuning: dict[str, float],
    limit: int,
) -> list[rec._Cand]:
    personal = await rec.taste(session, user)
    t = personal
    if seed_track or seed_artist:
        t = rec._blend(await rec._seed_taste(session, seed_track, seed_artist), personal)
    liked_here: list[uuid.UUID] = []
    for name in tuning:
        liked = _as_uuid(name[2:]) if name.startswith("l:") else None
        if liked is not None:
            liked_here.append(liked)
    cooc = await rec._co_listened(session, user, [*rec._top(t.tracks, 20), *liked_here])
    hidden = await rec.blocked(session, user)
    pool = await rec._candidate_ids(session, t, user, cooc) | await _settings_pool(
        session, user, ws, personal
    )
    never = set(hidden.tracks) | ({seed_track} if seed_track else set())

    cands = await _candidates(session, user, pool, never | set(served), hidden, limit)
    for window in REPEAT_WINDOWS:  # nothing new left: let older tracks come back
        if cands or not served:
            break
        recent = set(served[-window:]) if window else set()
        cands = await _candidates(session, user, pool, never | recent, hidden, limit)
    if not cands:
        return []

    listener = await _listener(session, user, ws, personal, cands)
    signals = await _signals(session, cands, ws) if ws.mood or ws.language else {}
    rng = random.Random()  # noqa: S311 - shuffling, not security
    judged = [
        _judge(base, x, ws, listener, signals.get(x.track.id), tuning)
        for base, x in rec._score(cands, t, cooc, rng, set())
    ]
    for level in range(4):
        fitting = [j for j in judged if j.passes(level)]
        if fitting:
            fitting.sort(key=lambda j: -j.score)
            return rec._diversify([j.cand for j in fitting], limit)
    return []


async def _candidates(
    session: AsyncSession,
    user: User,
    pool: set[uuid.UUID],
    exclude: set[uuid.UUID],
    hidden: rec.Blocked,
    limit: int,
) -> list[rec._Cand]:
    """Playable, not disliked candidates outside `exclude`; when the usual pool runs thin (a long
    session, a small catalogue) a random slice of the rest of the catalogue joins it."""

    def allowed(x: rec._Cand) -> bool:
        return not hidden.hides(x) and catalog.is_playable(x.track, user)

    cands = [x for x in await rec._load(session, pool - exclude) if allowed(x)]
    if len(cands) < limit * WIDEN_FACTOR:
        taken = exclude | {x.track.id for x in cands}
        query = (
            select(Track.id)
            .join(Track.release)
            .where(catalog.track_visible(rec._now()))
            .order_by(func.random())
            .limit(WIDEN_POOL)
        )
        if taken:
            query = query.where(Track.id.notin_(list(taken)))
        more = set(await session.scalars(query))
        cands += [x for x in await rec._load(session, more) if allowed(x)]
    return cands


async def _settings_pool(
    session: AsyncSession, user: User, ws: WaveSettings, personal: rec.Taste
) -> set[uuid.UUID]:
    """Extra candidates where the settings point: the base pool follows taste, popularity and
    novelty, which may hold few unheard, Russian, instrumental or calm tracks."""
    ids: set[uuid.UUID] = set()
    if ws.character == "favorite":
        ids |= set(rec._top(personal.tracks, 200))
    elif ws.character == "discover" and personal.genres:
        heard = select(ListeningHistory.track_id).where(ListeningHistory.user_id == user.id).scalar_subquery()
        ids |= set(
            await session.scalars(
                select(TrackGenre.track_id)
                .where(
                    TrackGenre.genre_id.in_(rec._top(personal.genres, 8)), TrackGenre.track_id.notin_(heard)
                )
                .limit(400)
            )
        )
    elif ws.character == "popular":
        ids |= set(
            await session.scalars(
                select(ListeningHistory.track_id)
                .where(
                    ListeningHistory.counted, ListeningHistory.played_at >= rec._now() - timedelta(days=30)
                )
                .group_by(ListeningHistory.track_id)
                .order_by(func.count().desc())
                .limit(150)
            )
        )
    matches = [m for m in (_language_sql(ws.language), _mood_sql(ws.mood)) if m is not None]
    if matches:
        ids |= set(
            await session.scalars(
                select(Track.id)
                .join(Track.release)
                .where(catalog.track_visible(rec._now()), or_(*matches))
                .order_by(func.random())
                .limit(WIDEN_POOL)
            )
        )
    return ids


def _like_any(words: Iterable[str], *columns: InstrumentedAttribute[str]) -> ColumnElement[bool]:
    """Coarse SQL version of `_mentions` for gathering candidates: ILIKE '%word%', where a space
    matches any one character ("hip hop" finds "Hip-Hop"). `_judge` has the final say."""
    patterns = [f"%{w.rstrip('*').replace(' ', '_')}%" for w in words]
    return or_(*[column.ilike(p) for column in columns for p in patterns])


def _language_sql(language: WaveLanguage | None) -> ColumnElement[bool] | None:
    if language is None:
        return None
    if language == "russian":
        return or_(
            Track.title.regexp_match(_CYRILLIC),
            Track.id.in_(
                select(TrackArtist.track_id)
                .join(Artist, Artist.id == TrackArtist.artist_id)
                .where(Artist.name.regexp_match(_CYRILLIC))
                .scalar_subquery()
            ),
            Track.id.in_(select(Lyrics.track_id).where(Lyrics.language.ilike("ru%")).scalar_subquery()),
            Track.id.in_(
                select(TrackFeatures.track_id)
                .where(TrackFeatures.vocal_language.ilike("ru%"))
                .scalar_subquery()
            ),
        )
    if language == "instrumental":
        return or_(
            Track.id.in_(
                select(TrackGenre.track_id)
                .join(Genre, Genre.id == TrackGenre.genre_id)
                .where(_like_any(_INSTRUMENTAL_GENRES, Genre.name, Genre.slug))
                .scalar_subquery()
            ),
            Track.id.in_(
                select(TrackFeatures.track_id)
                .where(
                    or_(
                        TrackFeatures.instrumentalness >= INSTRUMENTAL_MIN,
                        func.lower(TrackFeatures.vocal_language).in_(_NO_LANGUAGE),
                    )
                )
                .scalar_subquery()
            ),
        )
    # Foreign: the usual pool is mostly that already; just skip obviously Russian titles.
    return not_(Track.title.regexp_match(_CYRILLIC))


def _mood_sql(mood: WaveMood | None) -> ColumnElement[bool] | None:
    if mood is None:
        return None
    features = {
        "energetic": TrackFeatures.energy >= 0.6,
        "happy": TrackFeatures.valence >= 0.6,
        "calm": TrackFeatures.energy <= 0.4,
        "sad": TrackFeatures.valence <= 0.4,
    }[mood]
    return or_(
        Track.id.in_(select(TrackFeatures.track_id).where(features).scalar_subquery()),
        Track.id.in_(
            select(TrackMood.track_id)
            .join(Mood, Mood.id == TrackMood.mood_id)
            .where(_like_any(_MOOD_TAGS[mood], Mood.name, Mood.slug))
            .scalar_subquery()
        ),
        Track.id.in_(
            select(TrackGenre.track_id)
            .join(Genre, Genre.id == TrackGenre.genre_id)
            .where(_like_any(_MOOD_GENRES[mood], Genre.name, Genre.slug))
            .scalar_subquery()
        ),
    )


async def _listener(
    session: AsyncSession, user: User, ws: WaveSettings, personal: rec.Taste, cands: list[rec._Cand]
) -> _Listener:
    out = _Listener(
        tracks=rec._norm(personal.tracks), artists=rec._norm(personal.artists), recent=personal.recent
    )
    if ws.character == "discover":
        heard = select(ListeningHistory.track_id).where(ListeningHistory.user_id == user.id)
        out.heard = set(await session.scalars(heard.distinct()))
        out.heard |= set(
            await session.scalars(select(LikeTrack.track_id).where(LikeTrack.user_id == user.id))
        )
        out.known_artists = set(personal.artists) | set(
            await session.scalars(
                select(TrackArtist.artist_id)
                .where(TrackArtist.track_id.in_(heard.scalar_subquery()), TrackArtist.role.in_(rec.PERFORMER))
                .distinct()
            )
        )
    elif ws.character == "popular":
        plays: dict[uuid.UUID, float] = {}
        for track_id, n in await session.execute(
            select(ListeningHistory.track_id, func.count())
            .where(
                ListeningHistory.track_id.in_([x.track.id for x in cands]),
                ListeningHistory.counted,
                ListeningHistory.played_at >= rec._now() - timedelta(days=30),
            )
            .group_by(ListeningHistory.track_id)
        ):
            plays[track_id] = float(n)
        out.popularity = rec._norm(plays)
    return out


async def _signals(
    session: AsyncSession, cands: list[rec._Cand], ws: WaveSettings
) -> dict[uuid.UUID, _Signals]:
    ids = [x.track.id for x in cands]
    out = {
        x.track.id: _Signals(
            has_lyrics=x.track.has_lyrics,
            cyrillic_names=_has_cyrillic(x.track.title, *(link.artist.name for link in x.track.artist_links)),
        )
        for x in cands
    }
    for track_id, energy, valence, bpm, instrumentalness, vocal_language in await session.execute(
        select(
            TrackFeatures.track_id,
            TrackFeatures.energy,
            TrackFeatures.valence,
            TrackFeatures.bpm,
            TrackFeatures.instrumentalness,
            TrackFeatures.vocal_language,
        ).where(TrackFeatures.track_id.in_(ids))
    ):
        s = out[track_id]
        s.energy, s.valence, s.bpm = energy, valence, bpm
        s.instrumentalness, s.vocal_language = instrumentalness, vocal_language
    genre_ids = {g for x in cands for g in x.genres}
    names = {
        gid: _words(f"{name} {slug}")
        for gid, name, slug in await session.execute(
            select(Genre.id, Genre.name, Genre.slug).where(Genre.id.in_(genre_ids))
        )
    }
    for x in cands:
        out[x.track.id].genres = [names[g] for g in x.genres if g in names]
    if ws.mood:
        for track_id, name, slug in await session.execute(
            select(TrackMood.track_id, Mood.name, Mood.slug)
            .join(Mood, Mood.id == TrackMood.mood_id)
            .where(TrackMood.track_id.in_(ids))
        ):
            out[track_id].mood_tags.append(_words(f"{name} {slug}"))
    if ws.language:
        for track_id, language, cyrillic in await session.execute(
            select(Lyrics.track_id, Lyrics.language, cast(Lyrics.body, Text).regexp_match(_CYRILLIC)).where(
                Lyrics.track_id.in_(ids)
            )
        ):
            s = out[track_id]
            s.has_lyrics, s.lyrics_language, s.lyrics_cyrillic = True, language, bool(cyrillic)
    return out


def _judge(
    base: float,
    x: rec._Cand,
    ws: WaveSettings,
    listener: _Listener,
    signals: _Signals | None,
    tuning: dict[str, float],
) -> _Judged:
    nudge = sum(tuning.get(f"a:{a}", 0.0) for a in x.artists) + sum(
        tuning.get(f"g:{g}", 0.0) for g in x.genres
    )
    score = base + max(NUDGE_RANGE[0], min(NUDGE_RANGE[1], nudge))
    language_ok = mood_ok = character_ok = True
    if ws.language and signals is not None:
        language_ok = _language(signals) == ws.language
        score += LANGUAGE_WEIGHT if language_ok else 0.0
    if ws.mood and signals is not None:
        fit = _mood_fit(ws.mood, signals)
        if fit is not None:
            mood_ok = fit >= MOOD_TOLERANCE
            score += MOOD_WEIGHT * fit
    track_id = x.track.id
    artist_affinity = max((listener.artists.get(a, 0.0) for a in x.artists), default=0.0)
    if ws.character == "favorite":
        # Lean on what they like and play most; their favourites may come back even if heard
        # this week (the base ranking pushes those down).
        track_affinity = listener.tracks.get(track_id, 0.0)
        character_ok = track_affinity > 0 or artist_affinity > 0
        score += 2.0 * track_affinity + 1.0 * artist_affinity
        score += 1.0 if track_id in listener.recent and track_affinity > 0 else 0.0
    elif ws.character == "discover":
        # Never-played tracks only; artists they don't know yet first. Genre affinity from the base
        # ranking keeps it within their taste.
        character_ok = track_id not in listener.heard
        score += 1.0 if not any(a in listener.known_artists for a in x.artists) else -1.5 * artist_affinity
    elif ws.character == "popular":
        popularity = listener.popularity.get(track_id, 0.0)
        character_ok = popularity > 0 or x.track.play_count > 0
        score += 2.0 * popularity
    return _Judged(score, x, language_ok, mood_ok, character_ok)


# ---------------------------------------------------------------------------
# Mood and language of a track
# ---------------------------------------------------------------------------


def _words(text: str) -> str:
    return " ".join(re.split(r"[\W_]+", text.lower().replace("ё", "е"))).strip()


def _mention(words: list[str], padded: str, keyword: str) -> bool:
    if " " in keyword:
        return f" {keyword} " in padded
    if keyword.endswith("*"):
        return any(w.startswith(keyword[:-1]) for w in words)
    return keyword in words


def _mentions(text: str, keywords: Iterable[str]) -> bool:
    """Whether a `_words`-normalised name mentions any keyword (see the heuristics above)."""
    words, padded = text.split(), f" {text} "
    return any(_mention(words, padded, kw) for kw in keywords)


def _has_cyrillic(*texts: str) -> bool:
    return any(_CYRILLIC_RE.search(t) for t in texts)


def _clamp(value: float) -> float:
    return max(-1.0, min(1.0, value))


def _feature_fit(mood: WaveMood, s: _Signals) -> float | None:
    """Audio features: energy (or tempo when energy is missing) and valence, mapped to −1…1."""
    energy = s.energy
    if energy is None and s.bpm is not None:
        energy = max(0.0, min(1.0, (s.bpm - 70) / 100))  # 70 BPM and below → 0, 170 and above → 1
    if mood == "energetic":
        return None if energy is None else _clamp((energy - 0.5) * 2)
    if mood == "calm":
        return None if energy is None else _clamp((0.5 - energy) * 2)
    if s.valence is None:
        return None
    lift = (s.valence - 0.5) * 2 if energy is None else (s.valence - 0.5) * 1.5 + (energy - 0.5) * 0.5
    return _clamp(lift if mood == "happy" else -lift)


def _keyword_fit(
    mood: WaveMood, texts: list[str], words: dict[WaveMood, tuple[str, ...]], strength: float
) -> float | None:
    if any(_mentions(t, words[mood]) for t in texts):
        return strength
    if any(_mentions(t, words[_OPPOSITE[mood]]) for t in texts):
        return -strength
    return None


def _mood_fit(mood: WaveMood, s: _Signals) -> float | None:
    """−1 (the opposite mood) … 1 (exactly this mood); None when nothing is known. Audio features
    win, then mood tags, then the genre-name heuristic."""
    fit = _feature_fit(mood, s)
    if fit is None:
        fit = _keyword_fit(mood, s.mood_tags, _MOOD_TAGS, 0.8)
    if fit is None:
        fit = _keyword_fit(mood, s.genres, _MOOD_GENRES, 0.6)
    return fit


def _code_language(code: str | None) -> WaveLanguage | None:
    code = (code or "").strip().lower()
    if not code or code in _UNKNOWN_LANGUAGE:
        return None
    if code in _NO_LANGUAGE:
        return "instrumental"
    return "russian" if code.startswith("ru") else "foreign"


def _language(s: _Signals) -> WaveLanguage:
    """The analyser's vocal language, then the lyrics' language, then «no vocals» evidence
    (instrumentalness, instrumental genres — only for tracks without lyrics), then the alphabet:
    of the lyrics when there are any, else of the title and artist names."""
    known = _code_language(s.vocal_language) or _code_language(s.lyrics_language)
    if known is not None:
        return known
    if not s.has_lyrics and (
        (s.instrumentalness is not None and s.instrumentalness >= INSTRUMENTAL_MIN)
        or any(_mentions(g, _INSTRUMENTAL_GENRES) for g in s.genres)
    ):
        return "instrumental"
    cyrillic = s.cyrillic_names if s.lyrics_cyrillic is None else s.lyrics_cyrillic
    return "russian" if cyrillic else "foreign"
