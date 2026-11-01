from typing import Any

from pydantic import ValidationError

from sonora_api.core.config import Settings
from sonora_api.core.errors import AppError
from sonora_api.models import User
from sonora_api.schemas.me import MeOut, UserSettings
from sonora_api.services.media import AVATAR_SIZES, artwork


def me_out(settings: Settings, user: User) -> MeOut:
    avatar = artwork(settings, user.avatar_key, sizes=AVATAR_SIZES)
    return MeOut(
        id=user.id,
        email=user.email,
        email_verified=user.email_verified_at is not None,
        display_name=user.display_name,
        avatar_url=avatar.url_template.format(size=300, format="webp") if avatar else None,
        country=user.country,
        language=user.language,
        role=user.role,
        explicit_filter=user.explicit_filter,
        onboarding_completed=user.onboarding_completed,
        has_password=user.password_hash is not None,
        created_at=user.created_at,
    )


def read_settings(user: User) -> UserSettings:
    """Stored settings with defaults filled in. Stale keys from older app versions are dropped
    rather than failing the whole read."""
    try:
        return UserSettings.model_validate(user.settings or {})
    except ValidationError:
        return UserSettings.model_validate(_prune_invalid(user.settings or {}))


def _prune_invalid(raw: dict[str, Any]) -> dict[str, Any]:
    pruned: dict[str, Any] = {}
    for section, model in UserSettings.model_fields.items():
        value = raw.get(section)
        if not isinstance(value, dict) or model.annotation is None:
            continue
        section_model = model.annotation
        kept = {}
        for key, item in value.items():
            try:
                section_model.model_validate({key: item})
            except ValidationError:
                continue
            kept[key] = item
        pruned[section] = kept
    return pruned


def merge_patch(target: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """RFC 7396 JSON Merge Patch: objects merge recursively, `null` deletes (resets to default)."""
    result = dict(target)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_patch(result[key], value)
        else:
            result[key] = value
    return result


def apply_settings_patch(user: User, patch: dict[str, Any]) -> UserSettings:
    current = read_settings(user).model_dump(mode="json")
    try:
        updated = UserSettings.model_validate(merge_patch(current, patch))
    except ValidationError as exc:
        fields = [
            {"loc": [str(p) for p in e["loc"]], "message": e["msg"], "type": e["type"]}
            for e in exc.errors(include_url=False)
        ]
        raise AppError(
            "Invalid settings", code="validation_error", status_code=422, details={"fields": fields}
        ) from exc
    user.settings = updated.model_dump(mode="json")
    return updated
