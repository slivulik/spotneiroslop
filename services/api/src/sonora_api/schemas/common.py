from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ErrorDetail(BaseModel):
    code: str = Field(description="Stable machine-readable error code")
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class Page[T](ApiModel):
    items: list[T]
    next_cursor: str | None = Field(default=None, description="Pass as `cursor` to fetch the next page")


class AdminPage[T](ApiModel):
    """Offset page for admin tables (sortable, jump-to-page); public lists use cursors."""

    items: list[T]
    total: int
    offset: int
    limit: int


#: Response documentation shared by all routers.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": ErrorResponse} for status in (400, 401, 403, 404, 409, 422, 429)
}
