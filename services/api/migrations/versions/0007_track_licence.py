"""track licence and open-source origin (imports from Jamendo / Internet Archive)

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-12 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = (
    ("license_code", 64),
    ("license_url", 512),
    ("source_name", 32),
    ("source_external_id", 512),
    ("source_url", 512),
    ("attribution", 512),
)


def upgrade() -> None:
    for name, length in _COLUMNS:
        op.add_column("tracks", sa.Column(name, sa.String(length=length), nullable=True))
    op.create_index(
        "ix_tracks_source_external_id",
        "tracks",
        ["source_name", "source_external_id"],
        unique=True,
        postgresql_where=sa.text("source_external_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_tracks_source_external_id", table_name="tracks")
    for name, _ in reversed(_COLUMNS):
        op.drop_column("tracks", name)
