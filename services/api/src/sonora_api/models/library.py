import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from sonora_api.models.base import Base, created_at, pk_uuid, str_enum, updated_at
from sonora_api.models.enums import CoverMode, GeneratedKind, PlaylistType


class Playlist(Base):
    __tablename__ = "playlists"
    __table_args__ = (
        Index(
            "ix_playlists_generated_for",
            "generated_for_user_id",
            "generated_kind",
            postgresql_where=text("type = 'generated'"),
        ),
        CheckConstraint(
            "(type = 'generated') = (generated_kind IS NOT NULL)", name="generated_kind_matches_type"
        ),
    )

    id: Mapped[uuid.UUID] = pk_uuid()
    #: NULL for generated playlists (owned by the system).
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text)
    cover_key: Mapped[str | None] = mapped_column(String(512))
    cover_mode: Mapped[CoverMode] = mapped_column(
        str_enum(CoverMode, "cover_mode"), server_default=CoverMode.COLLAGE.value
    )
    is_public: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_collaborative: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    type: Mapped[PlaylistType] = mapped_column(
        str_enum(PlaylistType, "playlist_type"), server_default=PlaylistType.USER.value
    )
    generated_kind: Mapped[GeneratedKind | None] = mapped_column(str_enum(GeneratedKind, "generated_kind"))
    generated_for_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    valid_until: Mapped[datetime | None]
    track_count: Mapped[int] = mapped_column(Integer, server_default="0")
    total_duration_ms: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class PlaylistTrack(Base):
    """Playlist entry. `position` is a fractional index (base-62 string, compared with
    `COLLATE "C"`), so moving one track rewrites one row instead of renumbering the list."""

    __tablename__ = "playlist_tracks"
    __table_args__ = (UniqueConstraint("playlist_id", "position"),)

    id: Mapped[uuid.UUID] = pk_uuid()
    playlist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"))
    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), index=True)
    position: Mapped[str] = mapped_column(String(64, collation="C"))
    added_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = created_at()


class PlaylistCollaborator(Base):
    __tablename__ = "playlist_collaborators"

    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    invited_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at()


class LikeTrack(Base):
    __tablename__ = "likes_tracks"
    __table_args__ = (Index("ix_likes_tracks_user_recent", "user_id", text("created_at DESC")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    track_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = created_at()


class LikeRelease(Base):
    __tablename__ = "likes_releases"
    __table_args__ = (Index("ix_likes_releases_user_recent", "user_id", text("created_at DESC")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    release_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = created_at()


class FollowArtist(Base):
    __tablename__ = "follows_artists"
    __table_args__ = (Index("ix_follows_artists_user_recent", "user_id", text("created_at DESC")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = created_at()


class FollowPlaylist(Base):
    __tablename__ = "follows_playlists"
    __table_args__ = (Index("ix_follows_playlists_user_recent", "user_id", text("created_at DESC")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = created_at()


class Dislike(Base):
    """ "Don't play this" — a track or a whole artist, optionally for a limited time."""

    __tablename__ = "dislikes"
    __table_args__ = (
        CheckConstraint("(track_id IS NULL) <> (artist_id IS NULL)", name="exactly_one_target"),
        Index(
            "uq_dislikes_user_track",
            "user_id",
            "track_id",
            unique=True,
            postgresql_where=text("track_id IS NOT NULL"),
        ),
        Index(
            "uq_dislikes_user_artist",
            "user_id",
            "artist_id",
            unique=True,
            postgresql_where=text("artist_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    track_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"))
    artist_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"))
    until: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()


class ListeningHistory(Base):
    """Short history for "Recently played". Full event stream lives in ClickHouse."""

    __tablename__ = "listening_history"
    __table_args__ = (Index("ix_listening_history_user_recent", "user_id", text("played_at DESC")),)

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), index=True)
    played_at: Mapped[datetime] = created_at()
    ms_played: Mapped[int] = mapped_column(Integer)
    context_type: Mapped[str | None] = mapped_column(String(16))
    context_id: Mapped[uuid.UUID | None]


class SearchHistory(Base):
    __tablename__ = "search_history"
    __table_args__ = (Index("ix_search_history_user_recent", "user_id", text("created_at DESC")),)

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    query: Mapped[str | None] = mapped_column(String(256))
    entity_type: Mapped[str | None] = mapped_column(String(16))
    entity_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = created_at()


class IdempotencyKey(Base):
    """Stored responses for mutations replayed from offline queues (Idempotency-Key header)."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (Index("ix_idempotency_keys_created", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    response_status: Mapped[int] = mapped_column(Integer)
    response_body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
