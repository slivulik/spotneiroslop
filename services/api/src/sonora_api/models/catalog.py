from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sonora_api.models.base import Base, created_at, pk_uuid, str_enum, updated_at
from sonora_api.models.enums import (
    ArtistRole,
    CreditRole,
    LyricsSource,
    LyricsType,
    MediaStatus,
    Quality,
    ReleaseStatus,
    ReleaseType,
    SourceFormat,
    TrackStatus,
)

#: Embedding sizes. Changing one requires a migration + re-embedding (see ARCHITECTURE.md).
CONTENT_DIM = 512  # audio model (CLAP / MERT projection)
COLLAB_DIM = 128  # implicit-feedback matrix factorisation
HYBRID_DIM = 256  # learned fusion used for retrieval


class Artist(Base):
    __tablename__ = "artists"

    id: Mapped[uuid.UUID] = pk_uuid()
    name: Mapped[str] = mapped_column(String(255))
    sort_name: Mapped[str] = mapped_column(String(255), index=True)
    slug: Mapped[str] = mapped_column(String(255), unique=True)
    bio: Mapped[str | None] = mapped_column(Text)
    photo_key: Mapped[str | None] = mapped_column(String(512))
    photo_blurhash: Mapped[str | None] = mapped_column(String(64))
    #: Looping vertical header video (artist "canvas").
    header_video_key: Mapped[str | None] = mapped_column(String(512))
    palette: Mapped[dict[str, Any] | None]
    monthly_listeners: Mapped[int] = mapped_column(Integer, server_default="0")
    #: Attribution for an automatically found photo (Wikimedia Commons file page).
    photo_credit: Mapped[str | None] = mapped_column(String(512))
    #: Where the biography came from (Wikipedia article URL), shown under the text.
    bio_source: Mapped[str | None] = mapped_column(String(512))
    #: When open-database lookup last ran for this artist (so it isn't retried every upload).
    enriched_at: Mapped[datetime | None]
    verified: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class Release(Base):
    __tablename__ = "releases"
    __table_args__ = (
        Index("ix_releases_published", "release_date", postgresql_where=text("status = 'published'")),
    )

    id: Mapped[uuid.UUID] = pk_uuid()
    title: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255), index=True)
    type: Mapped[ReleaseType] = mapped_column(str_enum(ReleaseType, "release_type"))
    release_date: Mapped[date | None] = mapped_column(Date)
    #: Embargo: invisible to listeners until this moment even when published.
    publish_at: Mapped[datetime | None]
    label: Mapped[str | None] = mapped_column(String(255))
    upc: Mapped[str | None] = mapped_column(String(14), unique=True)
    cover_key: Mapped[str | None] = mapped_column(String(512))
    cover_blurhash: Mapped[str | None] = mapped_column(String(64))
    palette: Mapped[dict[str, Any] | None]
    total_duration_ms: Mapped[int] = mapped_column(Integer, server_default="0")
    track_count: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    is_explicit: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    status: Mapped[ReleaseStatus] = mapped_column(
        str_enum(ReleaseStatus, "release_status"), server_default=ReleaseStatus.DRAFT.value
    )
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    artist_links: Mapped[list[ReleaseArtist]] = relationship(
        order_by="ReleaseArtist.position", lazy="raise", cascade="all, delete-orphan"
    )


class ReleaseArtist(Base):
    __tablename__ = "release_artists"

    release_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[ArtistRole] = mapped_column(str_enum(ArtistRole, "artist_role"), primary_key=True)
    position: Mapped[int] = mapped_column(SmallInteger, server_default="0")

    artist: Mapped[Artist] = relationship(lazy="raise")


class Track(Base):
    __tablename__ = "tracks"
    __table_args__ = (
        Index("ix_tracks_ready_release", "release_id", postgresql_where=text("status = 'ready'")),
        Index(
            "ix_tracks_ready_play_count", text("play_count DESC"), postgresql_where=text("status = 'ready'")
        ),
        CheckConstraint("duration_ms >= 0", name="duration_non_negative"),
        # Candidate lookup for acoustic-fingerprint duplicate detection.
        Index("ix_tracks_duration_ms", "duration_ms"),
    )

    id: Mapped[uuid.UUID] = pk_uuid()
    release_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("releases.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    version: Mapped[str | None] = mapped_column(String(128))
    disc_number: Mapped[int] = mapped_column(SmallInteger, server_default="1")
    track_number: Mapped[int] = mapped_column(SmallInteger)
    duration_ms: Mapped[int] = mapped_column(Integer)
    isrc: Mapped[str | None] = mapped_column(String(12), index=True)
    is_explicit: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    source_format: Mapped[SourceFormat] = mapped_column(str_enum(SourceFormat, "source_format"))
    source_bit_depth: Mapped[int | None] = mapped_column(SmallInteger)
    source_sample_rate: Mapped[int | None] = mapped_column(Integer)
    source_sha256: Mapped[str | None] = mapped_column(String(64), unique=True)
    #: Chromaprint fingerprint (compressed base64) for duplicate detection across re-tags.
    fingerprint: Mapped[str | None] = mapped_column(Text)
    has_lyrics: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    lyrics_type: Mapped[LyricsType | None] = mapped_column(str_enum(LyricsType, "lyrics_type"))
    has_canvas: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    loudness_lufs: Mapped[float | None] = mapped_column(Float)
    true_peak: Mapped[float | None] = mapped_column(Float)
    track_gain: Mapped[float | None] = mapped_column(Float)
    album_gain: Mapped[float | None] = mapped_column(Float)
    preview_start_ms: Mapped[int | None] = mapped_column(Integer)
    #: 30-second preview (guests, share pages).
    preview_key: Mapped[str | None] = mapped_column(String(512))
    #: ABR master playlist for "Auto" quality (lossy tiers).
    hls_master_key: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[TrackStatus] = mapped_column(
        str_enum(TrackStatus, "track_status"), server_default=TrackStatus.PROCESSING.value
    )
    play_count: Mapped[int] = mapped_column(BigInteger, server_default="0")
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    release: Mapped[Release] = relationship(lazy="raise")
    artist_links: Mapped[list[TrackArtist]] = relationship(
        order_by="TrackArtist.position", lazy="raise", cascade="all, delete-orphan"
    )
    files: Mapped[list[TrackFile]] = relationship(lazy="raise", cascade="all, delete-orphan")


class TrackArtist(Base):
    __tablename__ = "track_artists"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[ArtistRole] = mapped_column(str_enum(ArtistRole, "artist_role"), primary_key=True)
    position: Mapped[int] = mapped_column(SmallInteger, server_default="0")

    artist: Mapped[Artist] = relationship(lazy="raise")


class TrackCredit(Base):
    __tablename__ = "track_credits"

    id: Mapped[uuid.UUID] = pk_uuid()
    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), index=True)
    person_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[CreditRole] = mapped_column(str_enum(CreditRole, "credit_role"))
    position: Mapped[int] = mapped_column(SmallInteger, server_default="0")


class TrackFile(Base):
    __tablename__ = "track_files"
    __table_args__ = (UniqueConstraint("track_id", "quality"),)

    id: Mapped[uuid.UUID] = pk_uuid()
    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"))
    quality: Mapped[Quality] = mapped_column(str_enum(Quality, "quality"))
    codec: Mapped[str] = mapped_column(String(16))
    bitrate: Mapped[int | None] = mapped_column(Integer)
    sample_rate: Mapped[int] = mapped_column(Integer)
    bit_depth: Mapped[int | None] = mapped_column(SmallInteger)
    channels: Mapped[int] = mapped_column(SmallInteger, server_default="2")
    #: Whole file for offline download.
    storage_key: Mapped[str] = mapped_column(String(512))
    #: HLS media playlist for this rendition (the master playlist lives on the track).
    hls_playlist_key: Mapped[str | None] = mapped_column(String(512))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    #: Gapless metadata: samples to trim at start/end (encoder delay / padding).
    encoder_delay: Mapped[int] = mapped_column(Integer, server_default="0")
    encoder_padding: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = created_at()


class TrackFeatures(Base):
    __tablename__ = "track_features"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    bpm: Mapped[float | None] = mapped_column(Float)
    key: Mapped[int | None] = mapped_column(SmallInteger)  # pitch class 0–11
    mode: Mapped[int | None] = mapped_column(SmallInteger)  # 1 major, 0 minor
    energy: Mapped[float | None] = mapped_column(Float)
    danceability: Mapped[float | None] = mapped_column(Float)
    valence: Mapped[float | None] = mapped_column(Float)
    acousticness: Mapped[float | None] = mapped_column(Float)
    instrumentalness: Mapped[float | None] = mapped_column(Float)
    speechiness: Mapped[float | None] = mapped_column(Float)
    vocal_language: Mapped[str | None] = mapped_column(String(8))
    #: Normalised peaks 0–255 for the progress-bar waveform.
    waveform: Mapped[list[int] | None] = mapped_column(ARRAY(SmallInteger))
    analyzer_version: Mapped[str | None] = mapped_column(String(32))
    updated_at: Mapped[datetime] = updated_at()


class TrackEmbedding(Base):
    __tablename__ = "track_embeddings"
    __table_args__ = (
        Index(
            "ix_track_embeddings_content_hnsw",
            "content_vec",
            postgresql_using="hnsw",
            postgresql_ops={"content_vec": "vector_cosine_ops"},
        ),
        Index(
            "ix_track_embeddings_collab_hnsw",
            "collab_vec",
            postgresql_using="hnsw",
            postgresql_ops={"collab_vec": "vector_cosine_ops"},
        ),
        Index(
            "ix_track_embeddings_hybrid_hnsw",
            "hybrid_vec",
            postgresql_using="hnsw",
            postgresql_ops={"hybrid_vec": "vector_cosine_ops"},
        ),
    )

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    content_vec: Mapped[list[float] | None] = mapped_column(Vector(CONTENT_DIM))
    collab_vec: Mapped[list[float] | None] = mapped_column(Vector(COLLAB_DIM))
    hybrid_vec: Mapped[list[float] | None] = mapped_column(Vector(HYBRID_DIM))
    model_version: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = updated_at()


class Lyrics(Base):
    __tablename__ = "lyrics"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    type: Mapped[LyricsType] = mapped_column(str_enum(LyricsType, "lyrics_type"))
    #: Canonical document defined in packages/lyrics-core.
    body: Mapped[dict[str, Any]]
    source: Mapped[LyricsSource] = mapped_column(str_enum(LyricsSource, "lyrics_source"))
    language: Mapped[str | None] = mapped_column(String(8))
    translation_language: Mapped[str | None] = mapped_column(String(8))
    updated_at: Mapped[datetime] = updated_at()


class Canvas(Base):
    __tablename__ = "canvases"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    #: {"720": "canvases/<id>/720.mp4", "1080": ...}
    video_keys: Mapped[dict[str, Any]]
    poster_key: Mapped[str | None] = mapped_column(String(512))
    duration_ms: Mapped[int] = mapped_column(Integer)
    status: Mapped[MediaStatus] = mapped_column(
        str_enum(MediaStatus, "media_status"), server_default=MediaStatus.PROCESSING.value
    )
    updated_at: Mapped[datetime] = updated_at()


class Genre(Base):
    __tablename__ = "genres"

    id: Mapped[uuid.UUID] = pk_uuid()
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("genres.id", ondelete="SET NULL"), index=True
    )
    color: Mapped[str | None] = mapped_column(String(9))
    cover_key: Mapped[str | None] = mapped_column(String(512))
    cover_blurhash: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(SmallInteger, server_default="0")


class TrackGenre(Base):
    __tablename__ = "track_genres"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    genre_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    weight: Mapped[float] = mapped_column(Float, server_default="1")


class Mood(Base):
    __tablename__ = "moods"

    id: Mapped[uuid.UUID] = pk_uuid()
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    color: Mapped[str | None] = mapped_column(String(9))
    cover_key: Mapped[str | None] = mapped_column(String(512))
    position: Mapped[int] = mapped_column(SmallInteger, server_default="0")


class TrackMood(Base):
    __tablename__ = "track_moods"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True)
    mood_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("moods.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    weight: Mapped[float] = mapped_column(Float, server_default="1")
