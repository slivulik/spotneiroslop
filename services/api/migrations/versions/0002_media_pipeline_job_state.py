"""media pipeline job state

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-01 06:10:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = postgresql.JSONB(astext_type=sa.Text())


def _replace_status_check(statuses: tuple[str, ...], length: int, default: str) -> None:
    # Enum stored as VARCHAR + CHECK: widen the column and swap the constraint.
    op.drop_constraint(op.f("ck_upload_jobs_job_status"), "upload_jobs", type_="check")
    op.alter_column("upload_jobs", "status", type_=sa.String(length=length), server_default=default)
    allowed = ", ".join(f"'{s}'" for s in statuses)
    op.create_check_constraint("job_status", "upload_jobs", f"status IN ({allowed})")


def _replace_active_index(statuses: tuple[str, ...]) -> None:
    allowed = ", ".join(f"'{s}'" for s in statuses)
    op.drop_index("ix_upload_jobs_active", table_name="upload_jobs")
    op.create_index(
        "ix_upload_jobs_active",
        "upload_jobs",
        ["created_at"],
        postgresql_where=sa.text(f"status IN ({allowed})"),
    )


def upgrade() -> None:
    op.create_index("ix_tracks_duration_ms", "tracks", ["duration_ms"], unique=False)
    op.add_column(
        "upload_jobs", sa.Column("state", _JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False)
    )
    op.add_column(
        "upload_jobs", sa.Column("warnings", _JSONB, server_default=sa.text("'[]'::jsonb"), nullable=False)
    )
    op.add_column(
        "upload_jobs", sa.Column("options", _JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False)
    )
    op.add_column("upload_jobs", sa.Column("attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("upload_jobs", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True))
    _replace_status_check(
        ("pending_upload", "queued", "running", "succeeded", "failed"), 14, "pending_upload"
    )
    _replace_active_index(("pending_upload", "queued", "running"))


def downgrade() -> None:
    _replace_active_index(("queued", "running"))
    op.execute("UPDATE upload_jobs SET status = 'queued' WHERE status = 'pending_upload'")
    _replace_status_check(("queued", "running", "succeeded", "failed"), 9, "queued")
    for column in ("finished_at", "attempts", "options", "warnings", "state"):
        op.drop_column("upload_jobs", column)
    op.drop_index("ix_tracks_duration_ms", table_name="tracks")
