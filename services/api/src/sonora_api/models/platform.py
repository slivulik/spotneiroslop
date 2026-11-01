import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from sonora_api.models.base import Base, created_at, pk_uuid, str_enum, updated_at
from sonora_api.models.enums import ExperimentStatus, JobStatus


class WaveSession(Base):
    __tablename__ = "wave_sessions"
    __table_args__ = (Index("ix_wave_sessions_user_recent", "user_id", text("last_event_at DESC")),)

    id: Mapped[uuid.UUID] = pk_uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    #: "user" (personal wave), "track", "artist", "release", "playlist", "genre", "mood".
    seed_type: Mapped[str] = mapped_column(String(16))
    seed_id: Mapped[uuid.UUID | None]
    settings: Mapped[dict[str, Any]] = mapped_column(server_default=text("'{}'::jsonb"))
    started_at: Mapped[datetime] = created_at()
    last_event_at: Mapped[datetime] = created_at()


class AbExperiment(Base):
    __tablename__ = "ab_experiments"

    id: Mapped[uuid.UUID] = pk_uuid()
    key: Mapped[str] = mapped_column(String(64), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    #: [{"name": "control", "weight": 50}, {"name": "treatment", "weight": 50}]
    variants: Mapped[list[dict[str, Any]]] = mapped_column(server_default=text("'[]'::jsonb"))
    status: Mapped[ExperimentStatus] = mapped_column(
        str_enum(ExperimentStatus, "experiment_status"), server_default=ExperimentStatus.DRAFT.value
    )
    created_at: Mapped[datetime] = created_at()


class AbAssignment(Base):
    __tablename__ = "ab_assignments"

    experiment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ab_experiments.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    variant: Mapped[str] = mapped_column(String(64))
    assigned_at: Mapped[datetime] = created_at()


class UploadJob(Base):
    __tablename__ = "upload_jobs"
    __table_args__ = (
        Index(
            "ix_upload_jobs_active", "created_at", postgresql_where=text("status IN ('queued', 'running')")
        ),
    )

    id: Mapped[uuid.UUID] = pk_uuid()
    admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    files: Mapped[list[dict[str, Any]]] = mapped_column(server_default=text("'[]'::jsonb"))
    status: Mapped[JobStatus] = mapped_column(
        str_enum(JobStatus, "job_status"), server_default=JobStatus.QUEUED.value
    )
    stage: Mapped[str | None] = mapped_column(String(32))
    error: Mapped[str | None] = mapped_column(Text)
    logs: Mapped[list[dict[str, Any]]] = mapped_column(server_default=text("'[]'::jsonb"))
    track_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tracks.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
