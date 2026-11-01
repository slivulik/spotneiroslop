import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from sonora_api.deps import AdminViewer, Ctx, Session
from sonora_api.models.enums import UserRole
from sonora_api.routers import API_V1
from sonora_api.schemas.admin_users import AdminUserPatch, AdminUserRow, StatsOut, StreamingOut
from sonora_api.schemas.common import ERROR_RESPONSES, AdminPage, ApiModel
from sonora_api.services import admin_users

router = APIRouter(prefix=f"{API_V1}/admin", tags=["admin"], responses=ERROR_RESPONSES)


@router.get("/stats")
async def stats(admin: AdminViewer, session: Session, ctx: Ctx) -> StatsOut:
    return await admin_users.stats(session, ctx.redis)


@router.get("/streaming")
async def streaming(admin: AdminViewer, session: Session, ctx: Ctx) -> StreamingOut:
    """Live listeners, plays per day, top tracks of the week."""
    return await admin_users.streaming(session, ctx.redis, ctx.settings)


@router.get("/users")
async def list_users(
    admin: AdminViewer,
    session: Session,
    q: str | None = None,
    role: UserRole | None = None,
    blocked: bool | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> AdminPage[AdminUserRow]:
    items, total = await admin_users.list_users(
        session, q=q, role=role, blocked=blocked, offset=offset, limit=limit
    )
    return AdminPage(items=items, total=total, offset=offset, limit=limit)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID, body: AdminUserPatch, admin: AdminViewer, session: Session, ctx: Ctx
) -> AdminUserRow:
    """Rename, change role, block (signs the user out everywhere) or unblock."""
    return await admin_users.update_user(session, ctx.redis, ctx.settings, admin.user, user_id, body)


class SignedOut(ApiModel):
    devices: int


@router.post("/users/{user_id}/sign-out")
async def sign_out(user_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx) -> SignedOut:
    return SignedOut(devices=await admin_users.sign_out_user(session, ctx.redis, ctx.settings, user_id))


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, admin: AdminViewer, session: Session, ctx: Ctx) -> None:
    await admin_users.delete_user(session, ctx.redis, ctx.settings, admin.user, user_id)
