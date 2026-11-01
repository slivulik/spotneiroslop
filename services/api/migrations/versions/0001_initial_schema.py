"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-11-01 05:18:00.587657
"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "ab_experiments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "variants",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "running",
                "stopped",
                name="experiment_status",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="draft",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ab_experiments")),
        sa.UniqueConstraint("key", name=op.f("uq_ab_experiments_key")),
    )
    op.create_table(
        "artists",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sort_name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("photo_key", sa.String(length=512), nullable=True),
        sa.Column("photo_blurhash", sa.String(length=64), nullable=True),
        sa.Column("header_video_key", sa.String(length=512), nullable=True),
        sa.Column("palette", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("monthly_listeners", sa.Integer(), server_default="0", nullable=False),
        sa.Column("verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_artists")),
        sa.UniqueConstraint("slug", name=op.f("uq_artists_slug")),
    )
    op.create_index(op.f("ix_artists_sort_name"), "artists", ["sort_name"], unique=False)
    op.create_table(
        "genres",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("cover_key", sa.String(length=512), nullable=True),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["genres.id"], name=op.f("fk_genres_parent_id_genres"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_genres")),
        sa.UniqueConstraint("slug", name=op.f("uq_genres_slug")),
    )
    op.create_index(op.f("ix_genres_parent_id"), "genres", ["parent_id"], unique=False)
    op.create_table(
        "moods",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("cover_key", sa.String(length=512), nullable=True),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_moods")),
        sa.UniqueConstraint("slug", name=op.f("uq_moods_slug")),
    )
    op.create_table(
        "releases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "album",
                "single",
                "ep",
                "compilation",
                name="release_type",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("release_date", sa.Date(), nullable=True),
        sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("upc", sa.String(length=14), nullable=True),
        sa.Column("cover_key", sa.String(length=512), nullable=True),
        sa.Column("cover_blurhash", sa.String(length=64), nullable=True),
        sa.Column("palette", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("total_duration_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("track_count", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("is_explicit", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "published",
                "hidden",
                name="release_status",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="draft",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_releases")),
        sa.UniqueConstraint("upc", name=op.f("uq_releases_upc")),
    )
    op.create_index(
        "ix_releases_published",
        "releases",
        ["release_date"],
        unique=False,
        postgresql_where=sa.text("status = 'published'"),
    )
    op.create_index(op.f("ix_releases_slug"), "releases", ["slug"], unique=False)
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("google_sub", sa.String(length=255), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("avatar_key", sa.String(length=512), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("language", sa.String(length=8), server_default="ru", nullable=False),
        sa.Column(
            "role",
            sa.Enum("user", "admin", name="user_role", native_enum=False, create_constraint=True),
            server_default="user",
            nullable=False,
        ),
        sa.Column("explicit_filter", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("onboarding_completed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
        sa.UniqueConstraint("google_sub", name=op.f("uq_users_google_sub")),
    )
    op.create_table(
        "ab_assignments",
        sa.Column("experiment_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("variant", sa.String(length=64), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["experiment_id"],
            ["ab_experiments.id"],
            name=op.f("fk_ab_assignments_experiment_id_ab_experiments"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ab_assignments_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("experiment_id", "user_id", name=op.f("pk_ab_assignments")),
    )
    op.create_index(op.f("ix_ab_assignments_user_id"), "ab_assignments", ["user_id"], unique=False)
    op.create_table(
        "devices",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "platform",
            sa.Enum("web", "android", name="platform", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("push_token", sa.Text(), nullable=True),
        sa.Column("offline_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_devices_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_devices")),
    )
    op.create_index(op.f("ix_devices_user_id"), "devices", ["user_id"], unique=False)
    op.create_table(
        "follows_artists",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("artist_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.id"],
            name=op.f("fk_follows_artists_artist_id_artists"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_follows_artists_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "artist_id", name=op.f("pk_follows_artists")),
    )
    op.create_index(op.f("ix_follows_artists_artist_id"), "follows_artists", ["artist_id"], unique=False)
    op.create_index(
        "ix_follows_artists_user_recent",
        "follows_artists",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "idempotency_keys",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_idempotency_keys_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "key", name=op.f("pk_idempotency_keys")),
    )
    op.create_index("ix_idempotency_keys_created", "idempotency_keys", ["created_at"], unique=False)
    op.create_table(
        "likes_releases",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("release_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["release_id"],
            ["releases.id"],
            name=op.f("fk_likes_releases_release_id_releases"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_likes_releases_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "release_id", name=op.f("pk_likes_releases")),
    )
    op.create_index(op.f("ix_likes_releases_release_id"), "likes_releases", ["release_id"], unique=False)
    op.create_index(
        "ix_likes_releases_user_recent",
        "likes_releases",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "playlists",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=True),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cover_key", sa.String(length=512), nullable=True),
        sa.Column(
            "cover_mode",
            sa.Enum("custom", "collage", name="cover_mode", native_enum=False, create_constraint=True),
            server_default="collage",
            nullable=False,
        ),
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_collaborative", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "user",
                "editorial",
                "generated",
                name="playlist_type",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="user",
            nullable=False,
        ),
        sa.Column(
            "generated_kind",
            sa.Enum(
                "daily",
                "mix",
                "discover",
                "radar",
                "premiere",
                name="generated_kind",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column("generated_for_user_id", sa.UUID(), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("track_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_duration_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(type = 'generated') = (generated_kind IS NOT NULL)",
            name=op.f("ck_playlists_generated_kind_matches_type"),
        ),
        sa.ForeignKeyConstraint(
            ["generated_for_user_id"],
            ["users.id"],
            name=op.f("fk_playlists_generated_for_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_playlists_owner_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_playlists")),
    )
    op.create_index(
        "ix_playlists_generated_for",
        "playlists",
        ["generated_for_user_id", "generated_kind"],
        unique=False,
        postgresql_where=sa.text("type = 'generated'"),
    )
    op.create_index(op.f("ix_playlists_owner_id"), "playlists", ["owner_id"], unique=False)
    op.create_table(
        "release_artists",
        sa.Column("release_id", sa.UUID(), nullable=False),
        sa.Column("artist_id", sa.UUID(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("main", "feat", "remixer", name="artist_role", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.id"],
            name=op.f("fk_release_artists_artist_id_artists"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["release_id"],
            ["releases.id"],
            name=op.f("fk_release_artists_release_id_releases"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("release_id", "artist_id", "role", name=op.f("pk_release_artists")),
    )
    op.create_index(op.f("ix_release_artists_artist_id"), "release_artists", ["artist_id"], unique=False)
    op.create_table(
        "search_history",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("query", sa.String(length=256), nullable=True),
        sa.Column("entity_type", sa.String(length=16), nullable=True),
        sa.Column("entity_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_search_history_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_search_history")),
    )
    op.create_index(
        "ix_search_history_user_recent",
        "search_history",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "tracks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("release_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("version", sa.String(length=128), nullable=True),
        sa.Column("disc_number", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("track_number", sa.SmallInteger(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("isrc", sa.String(length=12), nullable=True),
        sa.Column("is_explicit", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "source_format",
            sa.Enum("flac", "mp3", name="source_format", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("source_bit_depth", sa.SmallInteger(), nullable=True),
        sa.Column("source_sample_rate", sa.Integer(), nullable=True),
        sa.Column("source_sha256", sa.String(length=64), nullable=True),
        sa.Column("fingerprint", sa.Text(), nullable=True),
        sa.Column("has_lyrics", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "lyrics_type",
            sa.Enum("word", "line", "static", name="lyrics_type", native_enum=False, create_constraint=True),
            nullable=True,
        ),
        sa.Column("has_canvas", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("loudness_lufs", sa.Float(), nullable=True),
        sa.Column("true_peak", sa.Float(), nullable=True),
        sa.Column("track_gain", sa.Float(), nullable=True),
        sa.Column("album_gain", sa.Float(), nullable=True),
        sa.Column("preview_start_ms", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "processing",
                "ready",
                "failed",
                "hidden",
                name="track_status",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="processing",
            nullable=False,
        ),
        sa.Column("play_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("duration_ms >= 0", name=op.f("ck_tracks_duration_non_negative")),
        sa.ForeignKeyConstraint(
            ["release_id"], ["releases.id"], name=op.f("fk_tracks_release_id_releases"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tracks")),
        sa.UniqueConstraint("source_sha256", name=op.f("uq_tracks_source_sha256")),
    )
    op.create_index(op.f("ix_tracks_isrc"), "tracks", ["isrc"], unique=False)
    op.create_index(
        "ix_tracks_ready_play_count",
        "tracks",
        [sa.literal_column("play_count DESC")],
        unique=False,
        postgresql_where=sa.text("status = 'ready'"),
    )
    op.create_index(
        "ix_tracks_ready_release",
        "tracks",
        ["release_id"],
        unique=False,
        postgresql_where=sa.text("status = 'ready'"),
    )
    op.create_index(op.f("ix_tracks_release_id"), "tracks", ["release_id"], unique=False)
    op.create_table(
        "user_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum(
                "verify_email",
                "password_reset",
                name="token_purpose",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_tokens_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_user_tokens_token_hash")),
    )
    op.create_index(op.f("ix_user_tokens_user_id"), "user_tokens", ["user_id"], unique=False)
    op.create_table(
        "wave_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("seed_type", sa.String(length=16), nullable=False),
        sa.Column("seed_id", sa.UUID(), nullable=True),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "last_event_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_wave_sessions_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_wave_sessions")),
    )
    op.create_index(
        "ix_wave_sessions_user_recent",
        "wave_sessions",
        ["user_id", sa.literal_column("last_event_at DESC")],
        unique=False,
    )
    op.create_table(
        "canvases",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("video_keys", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("poster_key", sa.String(length=512), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "processing",
                "ready",
                "failed",
                name="media_status",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="processing",
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_canvases_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_canvases")),
    )
    op.create_table(
        "dislikes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("track_id", sa.UUID(), nullable=True),
        sa.Column("artist_id", sa.UUID(), nullable=True),
        sa.Column("until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(track_id IS NULL) <> (artist_id IS NULL)", name=op.f("ck_dislikes_exactly_one_target")
        ),
        sa.ForeignKeyConstraint(
            ["artist_id"], ["artists.id"], name=op.f("fk_dislikes_artist_id_artists"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_dislikes_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_dislikes_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dislikes")),
    )
    op.create_index(
        "uq_dislikes_user_artist",
        "dislikes",
        ["user_id", "artist_id"],
        unique=True,
        postgresql_where=sa.text("artist_id IS NOT NULL"),
    )
    op.create_index(
        "uq_dislikes_user_track",
        "dislikes",
        ["user_id", "track_id"],
        unique=True,
        postgresql_where=sa.text("track_id IS NOT NULL"),
    )
    op.create_table(
        "follows_playlists",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("playlist_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["playlist_id"],
            ["playlists.id"],
            name=op.f("fk_follows_playlists_playlist_id_playlists"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_follows_playlists_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "playlist_id", name=op.f("pk_follows_playlists")),
    )
    op.create_index(
        op.f("ix_follows_playlists_playlist_id"), "follows_playlists", ["playlist_id"], unique=False
    )
    op.create_index(
        "ix_follows_playlists_user_recent",
        "follows_playlists",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "likes_tracks",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_likes_tracks_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_likes_tracks_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "track_id", name=op.f("pk_likes_tracks")),
    )
    op.create_index(op.f("ix_likes_tracks_track_id"), "likes_tracks", ["track_id"], unique=False)
    op.create_index(
        "ix_likes_tracks_user_recent",
        "likes_tracks",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_table(
        "listening_history",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("played_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("ms_played", sa.Integer(), nullable=False),
        sa.Column("context_type", sa.String(length=16), nullable=True),
        sa.Column("context_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_listening_history_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_listening_history_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_listening_history")),
    )
    op.create_index(op.f("ix_listening_history_track_id"), "listening_history", ["track_id"], unique=False)
    op.create_index(
        "ix_listening_history_user_recent",
        "listening_history",
        ["user_id", sa.literal_column("played_at DESC")],
        unique=False,
    )
    op.create_table(
        "lyrics",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column(
            "type",
            sa.Enum("word", "line", "static", name="lyrics_type", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("body", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "source",
            sa.Enum(
                "manual",
                "ttml",
                "lrc",
                "auto",
                name="lyrics_source",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("language", sa.String(length=8), nullable=True),
        sa.Column("translation_language", sa.String(length=8), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_lyrics_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_lyrics")),
    )
    op.create_table(
        "playlist_collaborators",
        sa.Column("playlist_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("invited_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["invited_by"],
            ["users.id"],
            name=op.f("fk_playlist_collaborators_invited_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["playlist_id"],
            ["playlists.id"],
            name=op.f("fk_playlist_collaborators_playlist_id_playlists"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_playlist_collaborators_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("playlist_id", "user_id", name=op.f("pk_playlist_collaborators")),
    )
    op.create_index(
        op.f("ix_playlist_collaborators_user_id"), "playlist_collaborators", ["user_id"], unique=False
    )
    op.create_table(
        "playlist_tracks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("playlist_id", sa.UUID(), nullable=False),
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.String(length=64, collation="C"), nullable=False),
        sa.Column("added_by", sa.UUID(), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["added_by"], ["users.id"], name=op.f("fk_playlist_tracks_added_by_users"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["playlist_id"],
            ["playlists.id"],
            name=op.f("fk_playlist_tracks_playlist_id_playlists"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_playlist_tracks_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_playlist_tracks")),
        sa.UniqueConstraint("playlist_id", "position", name=op.f("uq_playlist_tracks_playlist_id_position")),
    )
    op.create_index(op.f("ix_playlist_tracks_track_id"), "playlist_tracks", ["track_id"], unique=False)
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("device_id", sa.UUID(), nullable=False),
        sa.Column("family_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name=op.f("fk_refresh_tokens_device_id_devices"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["replaced_by_id"],
            ["refresh_tokens.id"],
            name=op.f("fk_refresh_tokens_replaced_by_id_refresh_tokens"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_refresh_tokens_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_refresh_tokens_token_hash")),
    )
    op.create_index(op.f("ix_refresh_tokens_device_id"), "refresh_tokens", ["device_id"], unique=False)
    op.create_index(
        "ix_refresh_tokens_family_active",
        "refresh_tokens",
        ["family_id"],
        unique=False,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(op.f("ix_refresh_tokens_user_id"), "refresh_tokens", ["user_id"], unique=False)
    op.create_table(
        "track_artists",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("artist_id", sa.UUID(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("main", "feat", "remixer", name="artist_role", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"], ["artists.id"], name=op.f("fk_track_artists_artist_id_artists"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_artists_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", "artist_id", "role", name=op.f("pk_track_artists")),
    )
    op.create_index(op.f("ix_track_artists_artist_id"), "track_artists", ["artist_id"], unique=False)
    op.create_table(
        "track_credits",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("person_name", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "composer",
                "lyricist",
                "producer",
                "mixing",
                "mastering",
                "performer",
                name="credit_role",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_credits_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_track_credits")),
    )
    op.create_index(op.f("ix_track_credits_track_id"), "track_credits", ["track_id"], unique=False)
    op.create_table(
        "track_embeddings",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("content_vec", pgvector.sqlalchemy.vector.VECTOR(dim=512), nullable=True),
        sa.Column("collab_vec", pgvector.sqlalchemy.vector.VECTOR(dim=128), nullable=True),
        sa.Column("hybrid_vec", pgvector.sqlalchemy.vector.VECTOR(dim=256), nullable=True),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_embeddings_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_track_embeddings")),
    )
    op.create_index(
        "ix_track_embeddings_collab_hnsw",
        "track_embeddings",
        ["collab_vec"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"collab_vec": "vector_cosine_ops"},
    )
    op.create_index(
        "ix_track_embeddings_content_hnsw",
        "track_embeddings",
        ["content_vec"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"content_vec": "vector_cosine_ops"},
    )
    op.create_index(
        "ix_track_embeddings_hybrid_hnsw",
        "track_embeddings",
        ["hybrid_vec"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"hybrid_vec": "vector_cosine_ops"},
    )
    op.create_table(
        "track_features",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("bpm", sa.Float(), nullable=True),
        sa.Column("key", sa.SmallInteger(), nullable=True),
        sa.Column("mode", sa.SmallInteger(), nullable=True),
        sa.Column("energy", sa.Float(), nullable=True),
        sa.Column("danceability", sa.Float(), nullable=True),
        sa.Column("valence", sa.Float(), nullable=True),
        sa.Column("acousticness", sa.Float(), nullable=True),
        sa.Column("instrumentalness", sa.Float(), nullable=True),
        sa.Column("speechiness", sa.Float(), nullable=True),
        sa.Column("vocal_language", sa.String(length=8), nullable=True),
        sa.Column("waveform", postgresql.ARRAY(sa.SmallInteger()), nullable=True),
        sa.Column("analyzer_version", sa.String(length=32), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_features_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_track_features")),
    )
    op.create_table(
        "track_files",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column(
            "quality",
            sa.Enum(
                "hires",
                "lossless",
                "high",
                "normal",
                "low",
                name="quality",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("codec", sa.String(length=16), nullable=False),
        sa.Column("bitrate", sa.Integer(), nullable=True),
        sa.Column("sample_rate", sa.Integer(), nullable=False),
        sa.Column("bit_depth", sa.SmallInteger(), nullable=True),
        sa.Column("channels", sa.SmallInteger(), server_default="2", nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("hls_playlist_key", sa.String(length=512), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("encoder_delay", sa.Integer(), server_default="0", nullable=False),
        sa.Column("encoder_padding", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_files_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_track_files")),
        sa.UniqueConstraint("track_id", "quality", name=op.f("uq_track_files_track_id_quality")),
    )
    op.create_table(
        "track_genres",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("genre_id", sa.UUID(), nullable=False),
        sa.Column("weight", sa.Float(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(
            ["genre_id"], ["genres.id"], name=op.f("fk_track_genres_genre_id_genres"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_genres_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", "genre_id", name=op.f("pk_track_genres")),
    )
    op.create_index(op.f("ix_track_genres_genre_id"), "track_genres", ["genre_id"], unique=False)
    op.create_table(
        "track_moods",
        sa.Column("track_id", sa.UUID(), nullable=False),
        sa.Column("mood_id", sa.UUID(), nullable=False),
        sa.Column("weight", sa.Float(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(
            ["mood_id"], ["moods.id"], name=op.f("fk_track_moods_mood_id_moods"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_track_moods_track_id_tracks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("track_id", "mood_id", name=op.f("pk_track_moods")),
    )
    op.create_index(op.f("ix_track_moods_mood_id"), "track_moods", ["mood_id"], unique=False)
    op.create_table(
        "upload_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("admin_id", sa.UUID(), nullable=True),
        sa.Column(
            "files",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "succeeded",
                "failed",
                name="job_status",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="queued",
            nullable=False,
        ),
        sa.Column("stage", sa.String(length=32), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "logs",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("track_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["admin_id"], ["users.id"], name=op.f("fk_upload_jobs_admin_id_users"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], name=op.f("fk_upload_jobs_track_id_tracks"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_upload_jobs")),
    )
    op.create_index(
        "ix_upload_jobs_active",
        "upload_jobs",
        ["created_at"],
        unique=False,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.create_index(op.f("ix_upload_jobs_admin_id"), "upload_jobs", ["admin_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_upload_jobs_admin_id"), table_name="upload_jobs")
    op.drop_index(
        "ix_upload_jobs_active",
        table_name="upload_jobs",
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.drop_table("upload_jobs")
    op.drop_index(op.f("ix_track_moods_mood_id"), table_name="track_moods")
    op.drop_table("track_moods")
    op.drop_index(op.f("ix_track_genres_genre_id"), table_name="track_genres")
    op.drop_table("track_genres")
    op.drop_table("track_files")
    op.drop_table("track_features")
    op.drop_index(
        "ix_track_embeddings_hybrid_hnsw",
        table_name="track_embeddings",
        postgresql_using="hnsw",
        postgresql_ops={"hybrid_vec": "vector_cosine_ops"},
    )
    op.drop_index(
        "ix_track_embeddings_content_hnsw",
        table_name="track_embeddings",
        postgresql_using="hnsw",
        postgresql_ops={"content_vec": "vector_cosine_ops"},
    )
    op.drop_index(
        "ix_track_embeddings_collab_hnsw",
        table_name="track_embeddings",
        postgresql_using="hnsw",
        postgresql_ops={"collab_vec": "vector_cosine_ops"},
    )
    op.drop_table("track_embeddings")
    op.drop_index(op.f("ix_track_credits_track_id"), table_name="track_credits")
    op.drop_table("track_credits")
    op.drop_index(op.f("ix_track_artists_artist_id"), table_name="track_artists")
    op.drop_table("track_artists")
    op.drop_index(op.f("ix_refresh_tokens_user_id"), table_name="refresh_tokens")
    op.drop_index(
        "ix_refresh_tokens_family_active",
        table_name="refresh_tokens",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.drop_index(op.f("ix_refresh_tokens_device_id"), table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index(op.f("ix_playlist_tracks_track_id"), table_name="playlist_tracks")
    op.drop_table("playlist_tracks")
    op.drop_index(op.f("ix_playlist_collaborators_user_id"), table_name="playlist_collaborators")
    op.drop_table("playlist_collaborators")
    op.drop_table("lyrics")
    op.drop_index("ix_listening_history_user_recent", table_name="listening_history")
    op.drop_index(op.f("ix_listening_history_track_id"), table_name="listening_history")
    op.drop_table("listening_history")
    op.drop_index("ix_likes_tracks_user_recent", table_name="likes_tracks")
    op.drop_index(op.f("ix_likes_tracks_track_id"), table_name="likes_tracks")
    op.drop_table("likes_tracks")
    op.drop_index("ix_follows_playlists_user_recent", table_name="follows_playlists")
    op.drop_index(op.f("ix_follows_playlists_playlist_id"), table_name="follows_playlists")
    op.drop_table("follows_playlists")
    op.drop_index(
        "uq_dislikes_user_track", table_name="dislikes", postgresql_where=sa.text("track_id IS NOT NULL")
    )
    op.drop_index(
        "uq_dislikes_user_artist", table_name="dislikes", postgresql_where=sa.text("artist_id IS NOT NULL")
    )
    op.drop_table("dislikes")
    op.drop_table("canvases")
    op.drop_index("ix_wave_sessions_user_recent", table_name="wave_sessions")
    op.drop_table("wave_sessions")
    op.drop_index(op.f("ix_user_tokens_user_id"), table_name="user_tokens")
    op.drop_table("user_tokens")
    op.drop_index(op.f("ix_tracks_release_id"), table_name="tracks")
    op.drop_index(
        "ix_tracks_ready_release", table_name="tracks", postgresql_where=sa.text("status = 'ready'")
    )
    op.drop_index(
        "ix_tracks_ready_play_count", table_name="tracks", postgresql_where=sa.text("status = 'ready'")
    )
    op.drop_index(op.f("ix_tracks_isrc"), table_name="tracks")
    op.drop_table("tracks")
    op.drop_index("ix_search_history_user_recent", table_name="search_history")
    op.drop_table("search_history")
    op.drop_index(op.f("ix_release_artists_artist_id"), table_name="release_artists")
    op.drop_table("release_artists")
    op.drop_index(op.f("ix_playlists_owner_id"), table_name="playlists")
    op.drop_index(
        "ix_playlists_generated_for", table_name="playlists", postgresql_where=sa.text("type = 'generated'")
    )
    op.drop_table("playlists")
    op.drop_index("ix_likes_releases_user_recent", table_name="likes_releases")
    op.drop_index(op.f("ix_likes_releases_release_id"), table_name="likes_releases")
    op.drop_table("likes_releases")
    op.drop_index("ix_idempotency_keys_created", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
    op.drop_index("ix_follows_artists_user_recent", table_name="follows_artists")
    op.drop_index(op.f("ix_follows_artists_artist_id"), table_name="follows_artists")
    op.drop_table("follows_artists")
    op.drop_index(op.f("ix_devices_user_id"), table_name="devices")
    op.drop_table("devices")
    op.drop_index(op.f("ix_ab_assignments_user_id"), table_name="ab_assignments")
    op.drop_table("ab_assignments")
    op.drop_table("users")
    op.drop_index(op.f("ix_releases_slug"), table_name="releases")
    op.drop_index(
        "ix_releases_published", table_name="releases", postgresql_where=sa.text("status = 'published'")
    )
    op.drop_table("releases")
    op.drop_table("moods")
    op.drop_index(op.f("ix_genres_parent_id"), table_name="genres")
    op.drop_table("genres")
    op.drop_index(op.f("ix_artists_sort_name"), table_name="artists")
    op.drop_table("artists")
    op.drop_table("ab_experiments")
    op.execute("DROP EXTENSION IF EXISTS vector")
