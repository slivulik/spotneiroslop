from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, status

from sonora_api.core.context import AppContext
from sonora_api.core.errors import NotFoundError
from sonora_api.deps import Ctx, CurrentViewer, Session, auth_rate_limit
from sonora_api.models import Device, User
from sonora_api.models.enums import TokenPurpose
from sonora_api.routers import API_V1
from sonora_api.schemas.auth import (
    ForgotPasswordIn,
    GoogleLoginIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    ResetPasswordIn,
    TokenOut,
    VerifyEmailIn,
)
from sonora_api.schemas.common import ERROR_RESPONSES
from sonora_api.schemas.me import MeOut
from sonora_api.services import auth as auth_service
from sonora_api.services import mail_templates
from sonora_api.services.email import send_safely
from sonora_api.services.users import me_out

router = APIRouter(prefix=f"{API_V1}/auth", tags=["auth"], responses=ERROR_RESPONSES)
strict = [Depends(auth_rate_limit)]


async def _send_verification(session: Session, ctx: AppContext, user: User, tasks: BackgroundTasks) -> None:
    token = await auth_service.issue_user_token(
        session, user, TokenPurpose.VERIFY_EMAIL, timedelta(hours=ctx.settings.email_token_ttl_hours)
    )
    link = f"{ctx.settings.web_base_url}/verify-email?token={token}"
    mail = mail_templates.verify_email(user.display_name, link, ctx.settings.email_token_ttl_hours)
    tasks.add_task(send_safely, ctx.email, to=user.email, subject=mail.subject, text=mail.text)


@router.post("/register", status_code=status.HTTP_201_CREATED, dependencies=strict)
async def register(body: RegisterIn, session: Session, ctx: Ctx, tasks: BackgroundTasks) -> TokenOut:
    """Create an account with e-mail + password and sign in on the given device."""
    user = await auth_service.register_user(
        session, email=body.email, password=body.password, display_name=body.display_name
    )
    await _send_verification(session, ctx, user, tasks)
    return await auth_service.start_session(session, ctx.redis, ctx.settings, user, body.device)


@router.post("/login", dependencies=strict)
async def login(body: LoginIn, session: Session, ctx: Ctx) -> TokenOut:
    user = await auth_service.authenticate(session, email=body.email, password=body.password)
    return await auth_service.start_session(session, ctx.redis, ctx.settings, user, body.device)


@router.post("/google", dependencies=strict)
async def google(body: GoogleLoginIn, session: Session, ctx: Ctx) -> TokenOut:
    """Sign in with a Google ID token (web GIS or Android Credential Manager)."""
    identity = await ctx.google.verify(body.id_token)
    user = await auth_service.google_account(session, identity)
    return await auth_service.start_session(session, ctx.redis, ctx.settings, user, body.device)


@router.post("/refresh")
async def refresh(body: RefreshIn, session: Session, ctx: Ctx) -> TokenOut:
    """Exchange a refresh token for a new pair. The presented token becomes invalid.

    Only the default limiter applies: refresh tokens are 256-bit (nothing to brute-force) and a
    strict per-IP budget would lock out users behind carrier-grade NAT.
    """
    return await auth_service.refresh_session(session, ctx.redis, ctx.settings, body.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(viewer: CurrentViewer, session: Session, ctx: Ctx) -> None:
    """Sign out the current device."""
    device = await session.get(Device, viewer.claims.device_id)
    if device is None:
        raise NotFoundError("Device not found")
    await auth_service.end_session(session, ctx.redis, ctx.settings, device)


@router.post("/verify-email/resend", status_code=status.HTTP_202_ACCEPTED, dependencies=strict)
async def resend_verification(
    viewer: CurrentViewer, session: Session, ctx: Ctx, tasks: BackgroundTasks
) -> None:
    if viewer.user.email_verified_at is None:
        await _send_verification(session, ctx, viewer.user, tasks)
        await session.commit()


@router.post("/verify-email", dependencies=strict)
async def verify_email(body: VerifyEmailIn, session: Session, ctx: Ctx) -> MeOut:
    user = await auth_service.verify_email(session, body.token)
    return me_out(ctx.settings, user)


@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED, dependencies=strict)
async def forgot_password(body: ForgotPasswordIn, session: Session, ctx: Ctx, tasks: BackgroundTasks) -> None:
    """Always 202, whether or not the account exists (no e-mail enumeration)."""
    user = await auth_service.find_user_by_email(session, body.email)
    if user is None:
        return
    ttl = timedelta(minutes=ctx.settings.password_reset_ttl_minutes)
    token = await auth_service.issue_user_token(session, user, TokenPurpose.PASSWORD_RESET, ttl)
    await session.commit()
    link = f"{ctx.settings.web_base_url}/reset-password?token={token}"
    mail = mail_templates.password_reset(link, ctx.settings.password_reset_ttl_minutes)
    tasks.add_task(send_safely, ctx.email, to=user.email, subject=mail.subject, text=mail.text)


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT, dependencies=strict)
async def reset_password(body: ResetPasswordIn, session: Session, ctx: Ctx) -> None:
    """Set a new password and sign out every device."""
    await auth_service.reset_password(session, ctx.redis, ctx.settings, body.token, body.password)
