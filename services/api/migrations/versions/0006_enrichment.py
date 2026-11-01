"""enrichment: artist photo credit, biography source, last lookup time

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-01 17:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("artists", sa.Column("photo_credit", sa.String(length=512), nullable=True))
    op.add_column("artists", sa.Column("bio_source", sa.String(length=512), nullable=True))
    op.add_column("artists", sa.Column("enriched_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for column in ("enriched_at", "bio_source", "photo_credit"):
        op.drop_column("artists", column)
