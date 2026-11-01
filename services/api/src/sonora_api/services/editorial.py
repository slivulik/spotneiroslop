"""Home page composition, editorial playlists and genres (public reads + admin writes)."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError, ConflictError, NotFoundError
from sonora_api.core.ids import uuid7
from sonora_api.core.slugs import slugify
from sonora_api.models import (
    Artist,
    Genre,
    HomeSection,
    ListeningHistory,
    Playlist,
    PlaylistTrack,
    Release,
    ReleaseArtist,
    Track,
    TrackArtist,
    TrackGenre,
)
from sonora_api.models.enums import HomeSectionType, PlaylistType, SourceFormat, TrackStatus
from sonora_api.models.users import User
from sonora_api.schemas.catalog import Artwork, GenreOut, ReleaseSummary, TrackOut
from sonora_api.schemas.editorial import (
    ArtistSummary,
    GenreAdminIn,
    GenreAdminPatch,
    GenreDetail,
    HeroOut,
    HomeBlock,
    HomeOut,
    HomeSectionAdminOut,
    HomeSectionIn,
    HomeSectionPatch,
    PlaylistAdminIn,
    PlaylistAdminPatch,
    PlaylistOut,
    PlaylistSummary,
    SectionConfig,
)
from sonora_api.schemas.media import ImageRef
from sonora_api.services import catalog
from sonora_api.services.catalog import release_visible, track_out
from sonora_api.services.media import WIDE_ARTWORK_SIZES, artwork

MOSAIC = 4


def _now() -> datetime:
    return datetime.now(UTC)


def _ordered[T](rows: Sequence[T], ids: list[uuid.UUID], key: str = "id") -> list[T]:
    by_id = {getattr(r, key): r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


# ---------------------------------------------------------------------------
# Building blocks (all visibility-filtered)
# ---------------------------------------------------------------------------


async def _releases(session: AsyncSession, settings: Settings, config: SectionConfig) -> list[ReleaseSummary]:
    query = (
        select(Release)
        .where(
            release_visible(_now()),
            exists().where(Track.release_id == Release.id, Track.status == TrackStatus.READY),
        )
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
    )
    if config.source == "manual":
        rows = list(await session.scalars(query.where(Release.id.in_(config.ids))))
        rows = _ordered(rows, config.ids)
    else:
        if config.source == "hires":
            query = query.where(
                exists().where(
                    Track.release_id == Release.id,
                    Track.status == TrackStatus.READY,
                    Track.source_format == SourceFormat.FLAC,
                    Track.source_bit_depth >= 24,
                    Track.source_sample_rate >= 48_000,
                )
            )
        if config.source == "popular":
            plays = (
                select(func.coalesce(func.sum(Track.play_count), 0))
                .where(Track.release_id == Release.id)
                .scalar_subquery()
            )
            query = query.order_by(plays.desc(), Release.created_at.desc())
        else:
            query = query.order_by(Release.created_at.desc())
        rows = list(await session.scalars(query.limit(config.limit)))
    return [catalog._release_summary(settings, r) for r in rows[: config.limit]]


async def _tracks(
    session: AsyncSession, settings: Settings, config: SectionConfig, viewer: User | None
) -> list[TrackOut]:
    base = catalog._tracks_query(_now())
    if config.source == "manual":
        rows = _ordered(list(await session.scalars(base.where(Track.id.in_(config.ids)))), config.ids)
    elif config.source == "recent":
        if viewer is None:
            return []
        recent = (
            select(ListeningHistory.track_id, func.max(ListeningHistory.played_at).label("last"))
            .where(ListeningHistory.user_id == viewer.id)
            .group_by(ListeningHistory.track_id)
            .order_by(func.max(ListeningHistory.played_at).desc())
            .limit(config.limit)
        )
        ids = [row.track_id for row in await session.execute(recent)]
        rows = _ordered(list(await session.scalars(base.where(Track.id.in_(ids)))), ids)
    else:
        order = Track.play_count.desc() if config.source == "popular" else Track.created_at.desc()
        rows = list(await session.scalars(base.order_by(order, Track.id).limit(config.limit)))
    return [track_out(settings, t, viewer) for t in rows[: config.limit]]


def artist_summary(settings: Settings, a: Artist) -> ArtistSummary:
    return ArtistSummary(
        id=a.id,
        name=a.name,
        slug=a.slug,
        artwork=artwork(settings, a.photo_key, blurhash=a.photo_blurhash, palette=a.palette),
        verified=a.verified,
    )


async def _artists(session: AsyncSession, settings: Settings, config: SectionConfig) -> list[ArtistSummary]:
    has_music = exists().where(
        TrackArtist.artist_id == Artist.id,
        TrackArtist.track_id == Track.id,
        Track.status == TrackStatus.READY,
    )
    query = select(Artist).where(has_music)
    if config.source == "manual":
        rows = _ordered(list(await session.scalars(query.where(Artist.id.in_(config.ids)))), config.ids)
    else:
        plays = (
            select(func.coalesce(func.sum(Track.play_count), 0))
            .join(TrackArtist, TrackArtist.track_id == Track.id)
            .where(TrackArtist.artist_id == Artist.id)
            .scalar_subquery()
        )
        rows = list(await session.scalars(query.order_by(plays.desc(), Artist.name).limit(config.limit)))
    return [artist_summary(settings, a) for a in rows[: config.limit]]


def genre_out(settings: Settings, g: Genre) -> GenreOut:
    return GenreOut(
        id=g.id,
        slug=g.slug,
        name=g.name,
        parent_id=g.parent_id,
        color=g.color,
        artwork=artwork(settings, g.cover_key, blurhash=g.cover_blurhash),
    )


async def _genres(session: AsyncSession, settings: Settings, config: SectionConfig) -> list[GenreOut]:
    query = select(Genre)
    if config.source == "manual":
        rows = _ordered(list(await session.scalars(query.where(Genre.id.in_(config.ids)))), config.ids)
    else:
        used = exists().where(TrackGenre.genre_id == Genre.id)
        rows = list(
            await session.scalars(query.where(used).order_by(Genre.position, Genre.name).limit(config.limit))
        )
    return [genre_out(settings, g) for g in rows[: config.limit]]


async def _mosaics(
    session: AsyncSession, settings: Settings, playlist_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[Artwork]]:
    """Covers of the first distinct releases in each playlist (for collages)."""
    if not playlist_ids:
        return {}
    rows = await session.execute(
        select(
            PlaylistTrack.playlist_id, Release.id, Release.cover_key, Release.cover_blurhash, Release.palette
        )
        .join(Track, Track.id == PlaylistTrack.track_id)
        .join(Release, Release.id == Track.release_id)
        .where(PlaylistTrack.playlist_id.in_(playlist_ids), Release.cover_key.is_not(None))
        .order_by(PlaylistTrack.playlist_id, PlaylistTrack.position)
    )
    out: dict[uuid.UUID, list[Artwork]] = {}
    seen: dict[uuid.UUID, set[uuid.UUID]] = {}
    for playlist_id, release_id, key, blurhash, palette in rows:
        bucket = out.setdefault(playlist_id, [])
        if len(bucket) >= MOSAIC or release_id in seen.setdefault(playlist_id, set()):
            continue
        seen[playlist_id].add(release_id)
        art = artwork(settings, key, blurhash=blurhash, palette=palette)
        if art:
            bucket.append(art)
    return out


def _playlist_summary(
    settings: Settings, p: Playlist, mosaic: list[Artwork], owner_name: str | None
) -> PlaylistSummary:
    return PlaylistSummary(
        id=p.id,
        title=p.title,
        description=p.description,
        type=p.type,
        artwork=artwork(settings, p.cover_key, blurhash=p.cover_blurhash, palette=p.palette),
        mosaic=mosaic,
        track_count=p.track_count,
        owner_name=owner_name,
    )


async def _playlists(
    session: AsyncSession, settings: Settings, config: SectionConfig
) -> list[PlaylistSummary]:
    query = select(Playlist).where(
        Playlist.type == PlaylistType.EDITORIAL, Playlist.is_public, Playlist.track_count > 0
    )
    if config.source == "manual":
        rows = _ordered(list(await session.scalars(query.where(Playlist.id.in_(config.ids)))), config.ids)
    else:
        rows = list(await session.scalars(query.order_by(Playlist.updated_at.desc()).limit(config.limit)))
    rows = rows[: config.limit]
    mosaics = await _mosaics(session, settings, [p.id for p in rows])
    return [_playlist_summary(settings, p, mosaics.get(p.id, []), None) for p in rows]


def _hero(settings: Settings, config: SectionConfig) -> HeroOut | None:
    if config.image is None:
        return None
    art = artwork(
        settings,
        config.image.key,
        blurhash=config.image.blurhash,
        palette=config.image.palette.model_dump() if config.image.palette else None,
        sizes=WIDE_ARTWORK_SIZES,
    )
    return HeroOut(artwork=art, link=config.link, cta_label=config.cta_label) if art else None


async def resolve_block(
    session: AsyncSession,
    settings: Settings,
    *,
    block_id: str,
    type_: HomeSectionType,
    title: str,
    subtitle: str | None,
    config: SectionConfig,
    viewer: User | None,
) -> HomeBlock | None:
    block = HomeBlock(id=block_id, type=type_, style=config.style, title=title, subtitle=subtitle)
    match type_:
        case HomeSectionType.HERO:
            block.hero = _hero(settings, config)
            empty = block.hero is None
        case HomeSectionType.RELEASES:
            block.releases = await _releases(session, settings, config)
            empty = not block.releases
        case HomeSectionType.TRACKS:
            block.tracks = await _tracks(session, settings, config, viewer)
            empty = not block.tracks
        case HomeSectionType.PLAYLISTS:
            block.playlists = await _playlists(session, settings, config)
            empty = not block.playlists
        case HomeSectionType.ARTISTS:
            block.artists = await _artists(session, settings, config)
            empty = not block.artists
        case HomeSectionType.GENRES:
            block.genres = await _genres(session, settings, config)
            empty = not block.genres
    return None if empty else block


#: Used until an admin composes the page (and offered as a starting point in the builder).
DEFAULT_LAYOUT: list[tuple[HomeSectionType, str, str | None, SectionConfig]] = [
    (
        HomeSectionType.TRACKS,
        "Продолжить слушать",
        None,
        SectionConfig(source="recent", limit=8, style="grid"),
    ),
    (
        HomeSectionType.RELEASES,
        "Свежие релизы",
        "Только что вышло",
        SectionConfig(source="new", limit=15, style="stories"),
    ),
    (
        HomeSectionType.TRACKS,
        "Популярное сейчас",
        "Что слушают чаще всего",
        SectionConfig(source="popular", limit=10, style="list"),
    ),
    (
        HomeSectionType.PLAYLISTS,
        "Подборки редакции",
        None,
        SectionConfig(source="all", limit=12, style="shelf"),
    ),
    (
        HomeSectionType.RELEASES,
        "Hi-Res Lossless",
        "До 24 бит / 192 кГц",
        SectionConfig(source="hires", limit=12, style="shelf"),
    ),
    (HomeSectionType.RELEASES, "Новые альбомы", None, SectionConfig(source="new", limit=18, style="shelf")),
    (HomeSectionType.ARTISTS, "Артисты", None, SectionConfig(source="popular", limit=16, style="circles")),
    (
        HomeSectionType.GENRES,
        "Жанры и настроения",
        None,
        SectionConfig(source="all", limit=24, style="tiles"),
    ),
]


async def home(session: AsyncSession, settings: Settings, viewer: User | None) -> HomeOut:
    sections = list(
        await session.scalars(select(HomeSection).where(HomeSection.is_active).order_by(HomeSection.position))
    )
    blocks: list[HomeBlock] = []
    if sections:
        for s in sections:
            block = await resolve_block(
                session,
                settings,
                block_id=str(s.id),
                type_=s.type,
                title=s.title,
                subtitle=s.subtitle,
                config=SectionConfig.model_validate(s.config),
                viewer=viewer,
            )
            if block:
                blocks.append(block)
        return HomeOut(sections=blocks, is_default=False)
    for index, (type_, title, subtitle, config) in enumerate(DEFAULT_LAYOUT):
        block = await resolve_block(
            session, settings, block_id=f"default-{index}", type_=type_, title=title, subtitle=subtitle,
            config=config, viewer=viewer,
        )  # fmt: skip
        if block:
            blocks.append(block)
    return HomeOut(sections=blocks, is_default=True)


# ---------------------------------------------------------------------------
# Admin: home sections
# ---------------------------------------------------------------------------


def section_out(s: HomeSection) -> HomeSectionAdminOut:
    return HomeSectionAdminOut(
        id=s.id,
        type=s.type,
        title=s.title,
        subtitle=s.subtitle,
        position=s.position,
        is_active=s.is_active,
        config=SectionConfig.model_validate(s.config),
        updated_at=s.updated_at,
    )


async def list_sections(session: AsyncSession) -> list[HomeSectionAdminOut]:
    return [section_out(s) for s in await session.scalars(select(HomeSection).order_by(HomeSection.position))]


async def create_section(session: AsyncSession, body: HomeSectionIn) -> HomeSectionAdminOut:
    last = await session.scalar(select(func.max(HomeSection.position)))
    section = HomeSection(
        id=uuid7(),
        type=body.type,
        title=body.title,
        subtitle=body.subtitle,
        is_active=body.is_active,
        position=(last or 0) + 10,
        config=body.config.model_dump(mode="json"),
    )
    session.add(section)
    await session.commit()
    return section_out(section)


async def _section(session: AsyncSession, section_id: uuid.UUID) -> HomeSection:
    section = await session.get(HomeSection, section_id)
    if section is None:
        raise NotFoundError("Block not found")
    return section


async def update_section(
    session: AsyncSession, section_id: uuid.UUID, body: HomeSectionPatch
) -> HomeSectionAdminOut:
    section = await _section(session, section_id)
    changes = body.model_dump(exclude_unset=True)
    merged = HomeSectionIn.model_validate(
        {
            "type": section.type,
            "title": changes.get("title", section.title),
            "subtitle": changes.get("subtitle", section.subtitle),
            "is_active": changes.get("is_active", section.is_active),
            "config": changes.get("config", section.config),
        }
    )  # re-validates source/type consistency
    section.title, section.subtitle, section.is_active = merged.title, merged.subtitle, merged.is_active
    section.config = merged.config.model_dump(mode="json")
    await session.commit()
    return section_out(section)


async def delete_section(session: AsyncSession, section_id: uuid.UUID) -> None:
    await session.delete(await _section(session, section_id))
    await session.commit()


async def reorder_sections(session: AsyncSession, ids: list[uuid.UUID]) -> list[HomeSectionAdminOut]:
    sections = {s.id: s for s in await session.scalars(select(HomeSection))}
    if set(ids) != set(sections):
        raise AppError("Pass every block exactly once", code="validation_error", status_code=422)
    for index, section_id in enumerate(ids):
        sections[section_id].position = (index + 1) * 10
    await session.commit()
    return await list_sections(session)


async def seed_default_sections(session: AsyncSession) -> list[HomeSectionAdminOut]:
    """Materialise the built-in layout as editable blocks (only into an empty page)."""
    if await session.scalar(select(func.count()).select_from(HomeSection)):
        raise ConflictError("The home page already has blocks", code="home_not_empty")
    for index, (type_, title, subtitle, config) in enumerate(DEFAULT_LAYOUT):
        session.add(
            HomeSection(
                id=uuid7(), type=type_, title=title, subtitle=subtitle, position=(index + 1) * 10,
                config=config.model_dump(mode="json"),
            )
        )  # fmt: skip
    await session.commit()
    return await list_sections(session)


# ---------------------------------------------------------------------------
# Playlists
# ---------------------------------------------------------------------------


def _apply_cover(p: Playlist, cover: ImageRef | None) -> None:
    p.cover_key = cover.key if cover else None
    p.cover_blurhash = cover.blurhash if cover else None
    p.palette = cover.palette.model_dump() if cover and cover.palette else None


async def _owner_name(session: AsyncSession, p: Playlist) -> str | None:
    if p.type == PlaylistType.EDITORIAL or p.owner_id is None:
        return None
    return await session.scalar(select(User.display_name).where(User.id == p.owner_id))


async def playlist_out(
    session: AsyncSession, settings: Settings, p: Playlist, viewer: User | None
) -> PlaylistOut:
    rows = await session.scalars(
        catalog._tracks_query(_now())
        .join(PlaylistTrack, PlaylistTrack.track_id == Track.id)
        .where(PlaylistTrack.playlist_id == p.id)
        .order_by(PlaylistTrack.position)
    )
    tracks = [track_out(settings, t, viewer) for t in rows]
    mosaic = (await _mosaics(session, settings, [p.id])).get(p.id, [])
    summary = _playlist_summary(settings, p, mosaic, await _owner_name(session, p))
    return PlaylistOut(
        **summary.model_dump(exclude={"track_count"}),
        track_count=len(tracks),
        total_duration_ms=sum(t.duration_ms for t in tracks),
        updated_at=p.updated_at,
        tracks=tracks,
    )


async def get_public_playlist(
    session: AsyncSession, settings: Settings, playlist_id: uuid.UUID, viewer: User | None
) -> PlaylistOut:
    p = await session.get(Playlist, playlist_id)
    visible = p is not None and (p.is_public or (viewer is not None and p.owner_id == viewer.id))
    if not visible:
        raise NotFoundError("Playlist not found")
    assert p is not None  # noqa: S101
    return await playlist_out(session, settings, p, viewer)


async def admin_playlists(session: AsyncSession, settings: Settings) -> list[PlaylistSummary]:
    rows = list(
        await session.scalars(
            select(Playlist)
            .where(Playlist.type == PlaylistType.EDITORIAL)
            .order_by(Playlist.updated_at.desc())
        )
    )
    mosaics = await _mosaics(session, settings, [p.id for p in rows])
    return [_playlist_summary(settings, p, mosaics.get(p.id, []), None) for p in rows]


async def create_playlist(session: AsyncSession, admin: User, body: PlaylistAdminIn) -> Playlist:
    p = Playlist(
        id=uuid7(),
        owner_id=admin.id,
        title=body.title,
        description=body.description,
        is_public=body.is_public,
        type=PlaylistType.EDITORIAL,
    )
    _apply_cover(p, body.cover)
    session.add(p)
    await session.commit()
    return p


async def _editorial(session: AsyncSession, playlist_id: uuid.UUID) -> Playlist:
    p = await session.get(Playlist, playlist_id)
    if p is None or p.type != PlaylistType.EDITORIAL:
        raise NotFoundError("Playlist not found")
    return p


async def update_playlist(
    session: AsyncSession, playlist_id: uuid.UUID, body: PlaylistAdminPatch
) -> Playlist:
    p = await _editorial(session, playlist_id)
    changes = body.model_dump(exclude_unset=True)
    for field in ("title", "description", "is_public"):
        if field in changes:
            if field != "description" and changes[field] is None:
                raise AppError(f"{field} cannot be null", code="validation_error", status_code=422)
            setattr(p, field, changes[field])
    if "cover" in changes:
        _apply_cover(p, body.cover)
    p.updated_at = _now()
    await session.commit()
    return p


async def set_playlist_tracks(
    session: AsyncSession, playlist_id: uuid.UUID, track_ids: list[uuid.UUID], admin: User
) -> Playlist:
    p = await _editorial(session, playlist_id)
    unique = list(dict.fromkeys(track_ids))
    known = {
        row.id: row.duration_ms
        for row in await session.execute(select(Track.id, Track.duration_ms).where(Track.id.in_(unique)))
    }
    if missing := [str(t) for t in unique if t not in known]:
        raise AppError(
            "Unknown tracks", code="validation_error", status_code=422, details={"track_ids": missing}
        )
    await session.execute(delete(PlaylistTrack).where(PlaylistTrack.playlist_id == p.id))
    for index, track_id in enumerate(unique):
        # Zero-padded base-10 keys sort correctly under COLLATE "C"; gaps leave room for inserts.
        session.add(
            PlaylistTrack(
                id=uuid7(),
                playlist_id=p.id,
                track_id=track_id,
                position=f"{(index + 1) * 1000:012d}",
                added_by=admin.id,
            )
        )
    p.track_count = len(unique)
    p.total_duration_ms = sum(known[t] for t in unique)
    p.updated_at = _now()
    await session.commit()
    return p


async def delete_playlist(session: AsyncSession, playlist_id: uuid.UUID) -> None:
    await session.delete(await _editorial(session, playlist_id))
    await session.commit()


# ---------------------------------------------------------------------------
# Genres
# ---------------------------------------------------------------------------


async def genre_detail(
    session: AsyncSession, settings: Settings, slug: str, viewer: User | None
) -> GenreDetail:
    g = await session.scalar(select(Genre).where(Genre.slug == slug))
    if g is None:
        raise NotFoundError("Genre not found")
    in_genre = select(TrackGenre.track_id).where(TrackGenre.genre_id == g.id).scalar_subquery()
    tracks = await session.scalars(
        catalog._tracks_query(_now())
        .where(Track.id.in_(in_genre))
        .order_by(Track.play_count.desc(), Track.id)
        .limit(20)
    )
    releases = await session.scalars(
        select(Release)
        .where(
            release_visible(_now()),
            exists().where(
                Track.release_id == Release.id, Track.status == TrackStatus.READY, Track.id.in_(in_genre)
            ),
        )
        .options(selectinload(Release.artist_links).selectinload(ReleaseArtist.artist))
        .order_by(Release.created_at.desc())
        .limit(30)
    )
    return GenreDetail(
        genre=genre_out(settings, g),
        description=g.description,
        releases=[catalog._release_summary(settings, r) for r in releases],
        tracks=[track_out(settings, t, viewer) for t in tracks],
    )


def _apply_genre_cover(g: Genre, cover: ImageRef | None) -> None:
    g.cover_key = cover.key if cover else None
    g.cover_blurhash = cover.blurhash if cover else None


async def create_genre(session: AsyncSession, body: GenreAdminIn) -> Genre:
    slug = body.slug or slugify(body.name, max_length=64)
    if await session.scalar(select(Genre.id).where(Genre.slug == slug)):
        raise ConflictError("A genre with this slug exists", code="slug_taken")
    g = Genre(
        id=uuid7(),
        slug=slug,
        name=body.name,
        color=body.color,
        description=body.description,
        position=body.position or 0,
    )
    _apply_genre_cover(g, body.cover)
    session.add(g)
    await session.commit()
    return g


async def update_genre(session: AsyncSession, genre_id: uuid.UUID, body: GenreAdminPatch) -> Genre:
    g = await session.get(Genre, genre_id)
    if g is None:
        raise NotFoundError("Genre not found")
    changes = body.model_dump(exclude_unset=True)
    if "slug" in changes and changes["slug"] and changes["slug"] != g.slug:
        if await session.scalar(select(Genre.id).where(Genre.slug == changes["slug"])):
            raise ConflictError("A genre with this slug exists", code="slug_taken")
        g.slug = changes["slug"]
    for field in ("name", "color", "description", "position"):
        if field in changes:
            if field == "name" and not changes[field]:
                raise AppError("name cannot be empty", code="validation_error", status_code=422)
            setattr(g, field, changes[field] if field != "position" else (changes[field] or 0))
    if "cover" in changes:
        _apply_genre_cover(g, body.cover)
    await session.commit()
    return g


async def delete_genre(session: AsyncSession, genre_id: uuid.UUID) -> None:
    g = await session.get(Genre, genre_id)
    if g is None:
        raise NotFoundError("Genre not found")
    await session.delete(g)
    await session.commit()


async def all_genres(
    session: AsyncSession, settings: Settings
) -> list[tuple[GenreOut, int, str | None, int]]:
    """(genre, track count, description, position) for the admin list."""
    counts = select(TrackGenre.genre_id, func.count().label("n")).group_by(TrackGenre.genre_id).subquery()
    rows = await session.execute(
        select(Genre, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.genre_id == Genre.id)
        .order_by(Genre.position, Genre.name)
    )
    return [(genre_out(settings, g), int(n), g.description, g.position) for g, n in rows]
