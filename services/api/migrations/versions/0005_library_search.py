"""library and search: trigram indexes for typo-tolerant search, search history recency

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-01 16:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TRGM = {
    "ix_tracks_title_trgm": "tracks",
    "ix_releases_title_trgm": "releases",
    "ix_playlists_title_trgm": "playlists",
}


def upgrade() -> None:
    # pg_trgm is a trusted extension (PG ≥ 13): the database owner may create it.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table in TRGM.items():
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin (lower(title) gin_trgm_ops)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_artists_name_trgm ON artists USING gin (lower(name) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_genres_name_trgm ON genres USING gin (lower(name) gin_trgm_ops)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_search_history_recent ON search_history (created_at DESC)")


def downgrade() -> None:
    for name in [*TRGM, "ix_artists_name_trgm", "ix_genres_name_trgm", "ix_search_history_recent"]:
        op.execute(f"DROP INDEX IF EXISTS {name}")
