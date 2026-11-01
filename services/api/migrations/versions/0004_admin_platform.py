"""admin panel: home sections, editorial images, user blocking, platform settings, play events

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-01 11:22:12.697287
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "home_sections",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "hero",
                "releases",
                "tracks",
                "playlists",
                "artists",
                "genres",
                name="home_section_type",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("subtitle", sa.String(length=256), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_home_sections")),
    )
    op.create_index(
        "ix_home_sections_active_position",
        "home_sections",
        ["position"],
        unique=False,
        postgresql_where=sa.text("is_active"),
    )
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column(
            "value",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_platform_settings_updated_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_platform_settings")),
    )
    op.add_column("genres", sa.Column("cover_blurhash", sa.String(length=64), nullable=True))
    op.add_column("genres", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("listening_history", sa.Column("event_id", sa.UUID(), nullable=True))
    op.add_column(
        "listening_history",
        sa.Column("counted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("listening_history", sa.Column("device_id", sa.UUID(), nullable=True))
    op.create_index(
        "ix_listening_history_recent",
        "listening_history",
        [sa.literal_column("played_at DESC")],
        unique=False,
    )
    op.create_unique_constraint(op.f("uq_listening_history_event_id"), "listening_history", ["event_id"])
    op.add_column("playlists", sa.Column("cover_blurhash", sa.String(length=64), nullable=True))
    op.add_column("playlists", sa.Column("palette", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("users", sa.Column("blocked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("block_reason", sa.String(length=256), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "block_reason")
    op.drop_column("users", "blocked_at")
    op.drop_column("playlists", "palette")
    op.drop_column("playlists", "cover_blurhash")
    op.drop_constraint(op.f("uq_listening_history_event_id"), "listening_history", type_="unique")
    op.drop_index("ix_listening_history_recent", table_name="listening_history")
    op.drop_column("listening_history", "device_id")
    op.drop_column("listening_history", "counted")
    op.drop_column("listening_history", "event_id")
    op.drop_column("genres", "description")
    op.drop_column("genres", "cover_blurhash")
    op.drop_table("platform_settings")
    op.drop_index(
        "ix_home_sections_active_position", table_name="home_sections", postgresql_where=sa.text("is_active")
    )
    op.drop_table("home_sections")
