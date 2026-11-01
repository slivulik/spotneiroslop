import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Body, File, Query, UploadFile, status

from sonora_api.deps import AdminViewer, Ctx, Session
from sonora_api.models.enums import ImageKind
from sonora_api.routers import API_V1
from sonora_api.schemas.catalog import GenreOut
from sonora_api.schemas.common import ERROR_RESPONSES, ApiModel
from sonora_api.schemas.editorial import (
    GenreAdminIn,
    GenreAdminPatch,
    HomeOut,
    HomeSectionAdminOut,
    HomeSectionIn,
    HomeSectionPatch,
    PlaylistAdminIn,
    PlaylistAdminPatch,
    PlaylistOut,
    PlaylistSummary,
    PlaylistTracksIn,
    ReorderIn,
)
from sonora_api.schemas.media import ImageOut
from sonora_api.services import editorial, platform
from sonora_api.services.images import upload_image

router = APIRouter(prefix=f"{API_V1}/admin", tags=["admin"], responses=ERROR_RESPONSES)


# --- images ------------------------------------------------------------------------------


@router.post("/images", status_code=status.HTTP_201_CREATED)
async def upload(
    admin: AdminViewer, ctx: Ctx, file: Annotated[UploadFile, File()], kind: Annotated[ImageKind, Query()]
) -> ImageOut:
    """Upload a cover/photo/banner. Returns a reference to store on the entity."""
    return await upload_image(ctx, kind, await file.read())


# --- home page ---------------------------------------------------------------------------


@router.get("/home/sections")
async def list_sections(admin: AdminViewer, session: Session) -> list[HomeSectionAdminOut]:
    return await editorial.list_sections(session)


@router.post("/home/sections", status_code=status.HTTP_201_CREATED)
async def create_section(body: HomeSectionIn, admin: AdminViewer, session: Session) -> HomeSectionAdminOut:
    return await editorial.create_section(session, body)


@router.patch("/home/sections/{section_id}")
async def update_section(
    section_id: uuid.UUID, body: HomeSectionPatch, admin: AdminViewer, session: Session
) -> HomeSectionAdminOut:
    return await editorial.update_section(session, section_id, body)


@router.delete("/home/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(section_id: uuid.UUID, admin: AdminViewer, session: Session) -> None:
    await editorial.delete_section(session, section_id)


@router.put("/home/order")
async def reorder(body: ReorderIn, admin: AdminViewer, session: Session) -> list[HomeSectionAdminOut]:
    return await editorial.reorder_sections(session, body.ids)


@router.post("/home/seed")
async def seed(admin: AdminViewer, session: Session) -> list[HomeSectionAdminOut]:
    """Turn the built-in default page into editable blocks."""
    return await editorial.seed_default_sections(session)


@router.post("/home/preview")
async def preview_section(body: HomeSectionIn, admin: AdminViewer, session: Session, ctx: Ctx) -> HomeOut:
    """Resolve one block without saving it (live preview in the builder)."""
    block = await editorial.resolve_block(
        session, ctx.settings, block_id="preview", type_=body.type, title=body.title,
        subtitle=body.subtitle, config=body.config, viewer=admin.user,
    )  # fmt: skip
    return HomeOut(sections=[block] if block else [], is_default=False)


# --- playlists ---------------------------------------------------------------------------


@router.get("/playlists")
async def list_playlists(admin: AdminViewer, session: Session, ctx: Ctx) -> list[PlaylistSummary]:
    return await editorial.admin_playlists(session, ctx.settings)


@router.post("/playlists", status_code=status.HTTP_201_CREATED)
async def create_playlist(
    body: PlaylistAdminIn, admin: AdminViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    p = await editorial.create_playlist(session, admin.user, body)
    return await editorial.playlist_out(session, ctx.settings, p, admin.user)


@router.get("/playlists/{playlist_id}")
async def get_playlist(playlist_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx) -> PlaylistOut:
    p = await editorial._editorial(session, playlist_id)
    return await editorial.playlist_out(session, ctx.settings, p, admin.user)


@router.patch("/playlists/{playlist_id}")
async def update_playlist(
    playlist_id: uuid.UUID, body: PlaylistAdminPatch, admin: AdminViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    p = await editorial.update_playlist(session, playlist_id, body)
    return await editorial.playlist_out(session, ctx.settings, p, admin.user)


@router.put("/playlists/{playlist_id}/tracks")
async def set_tracks(
    playlist_id: uuid.UUID, body: PlaylistTracksIn, admin: AdminViewer, session: Session, ctx: Ctx
) -> PlaylistOut:
    """Replace the playlist's tracks with this ordered list (add, remove and reorder in one call)."""
    p = await editorial.set_playlist_tracks(session, playlist_id, body.track_ids, admin.user)
    return await editorial.playlist_out(session, ctx.settings, p, admin.user)


@router.delete("/playlists/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(playlist_id: uuid.UUID, admin: AdminViewer, session: Session) -> None:
    await editorial.delete_playlist(session, playlist_id)


# --- genres ------------------------------------------------------------------------------


class AdminGenre(GenreOut):
    track_count: int
    description: str | None
    position: int


@router.get("/genres")
async def list_genres(admin: AdminViewer, session: Session, ctx: Ctx) -> list[AdminGenre]:
    return [
        AdminGenre(**g.model_dump(), track_count=n, description=d, position=pos)
        for g, n, d, pos in await editorial.all_genres(session, ctx.settings)
    ]


@router.post("/genres", status_code=status.HTTP_201_CREATED)
async def create_genre(body: GenreAdminIn, admin: AdminViewer, session: Session, ctx: Ctx) -> GenreOut:
    return editorial.genre_out(ctx.settings, await editorial.create_genre(session, body))


@router.patch("/genres/{genre_id}")
async def update_genre(
    genre_id: uuid.UUID, body: GenreAdminPatch, admin: AdminViewer, session: Session, ctx: Ctx
) -> GenreOut:
    return editorial.genre_out(ctx.settings, await editorial.update_genre(session, genre_id, body))


@router.delete("/genres/{genre_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_genre(genre_id: uuid.UUID, admin: AdminViewer, session: Session) -> None:
    await editorial.delete_genre(session, genre_id)


# --- platform switches -------------------------------------------------------------------


class PlatformConfigOut(ApiModel):
    config: dict[str, Any]


@router.get("/platform")
async def get_platform(admin: AdminViewer, session: Session) -> platform.PlatformConfig:
    return await platform.get_config(session)


@router.patch("/platform")
async def patch_platform(
    admin: AdminViewer, session: Session, patch: dict[str, Any] = Body(description="JSON Merge Patch")
) -> platform.PlatformConfig:
    return await platform.update_config(session, patch, admin_id=admin.user.id)
