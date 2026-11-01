import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, MetaData, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from sonora_api.core.ids import uuid7

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {  # noqa: RUF012 - SQLAlchemy reads this as a class attribute
        dict[str, Any]: JSONB,
        list[dict[str, Any]]: JSONB,
        uuid.UUID: UUID(as_uuid=True),
        datetime: DateTime(timezone=True),
    }


def str_enum[E: enum.StrEnum](enum_cls: type[E], name: str) -> Enum:
    """Enum stored as VARCHAR + CHECK constraint.

    Native PG enums need `ALTER TYPE` migrations that can't run in a transaction; a
    check constraint is trivially replaceable when a new value is added.
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=max(len(m.value) for m in enum_cls),
        values_callable=lambda cls: [m.value for m in cls],
        validate_strings=True,
    )


def pk_uuid() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid7)


def created_at() -> Mapped[datetime]:
    return mapped_column(server_default=func.now(), nullable=False)


def updated_at() -> Mapped[datetime]:
    return mapped_column(server_default=func.now(), onupdate=func.now(), nullable=False)
