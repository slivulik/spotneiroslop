import uuid

from pydantic import EmailStr, Field, field_validator

from sonora_api.models.enums import Platform
from sonora_api.schemas.common import ApiModel
from sonora_api.schemas.me import MeOut

PASSWORD_MIN = 8
PASSWORD_MAX = 128


class DeviceIn(ApiModel):
    platform: Platform
    name: str = Field(min_length=1, max_length=128, description="Human-readable, e.g. 'Chrome on macOS'")
    model: str | None = Field(default=None, max_length=128)
    app_version: str | None = Field(default=None, max_length=32)
    device_id: uuid.UUID | None = Field(
        default=None, description="Previously issued device id; re-login on the same device reuses it"
    )


def _check_password(value: str) -> str:
    if value.strip() != value:
        raise ValueError("password must not start or end with whitespace")
    if len(set(value)) < 4:
        raise ValueError("password is too simple")
    return value


class RegisterIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    display_name: str = Field(min_length=1, max_length=64)
    device: DeviceIn

    _password = field_validator("password")(_check_password)

    @field_validator("display_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("display_name must not be blank")
        return stripped


class LoginIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    device: DeviceIn


class GoogleLoginIn(ApiModel):
    id_token: str = Field(min_length=10, max_length=8192)
    device: DeviceIn


class RefreshIn(ApiModel):
    refresh_token: str = Field(min_length=20, max_length=256)


class TokenOut(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int = Field(description="Access token lifetime, seconds")
    refresh_expires_in: int = Field(description="Refresh token lifetime, seconds")
    device_id: uuid.UUID
    user: MeOut


class VerifyEmailIn(ApiModel):
    token: str = Field(min_length=20, max_length=256)


class ForgotPasswordIn(ApiModel):
    email: EmailStr


class ResetPasswordIn(ApiModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)

    _password = field_validator("password")(_check_password)
