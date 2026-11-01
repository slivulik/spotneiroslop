"""track media keys

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-01 06:40:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("preview_key", sa.String(length=512), nullable=True))
    op.add_column("tracks", sa.Column("hls_master_key", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("tracks", "hls_master_key")
    op.drop_column("tracks", "preview_key")
