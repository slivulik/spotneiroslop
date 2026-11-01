from enum import StrEnum


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"


class Platform(StrEnum):
    WEB = "web"
    ANDROID = "android"


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    PASSWORD_RESET = "password_reset"  # noqa: S105 - enum label, not a secret


class ReleaseType(StrEnum):
    ALBUM = "album"
    SINGLE = "single"
    EP = "ep"
    COMPILATION = "compilation"


class ReleaseStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    HIDDEN = "hidden"


class TrackStatus(StrEnum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    HIDDEN = "hidden"


class ArtistRole(StrEnum):
    MAIN = "main"
    FEAT = "feat"
    REMIXER = "remixer"


class CreditRole(StrEnum):
    COMPOSER = "composer"
    LYRICIST = "lyricist"
    PRODUCER = "producer"
    MIXING = "mixing"
    MASTERING = "mastering"
    PERFORMER = "performer"


class SourceFormat(StrEnum):
    FLAC = "flac"
    MP3 = "mp3"


class Quality(StrEnum):
    HIRES = "hires"
    LOSSLESS = "lossless"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class LyricsType(StrEnum):
    WORD = "word"
    LINE = "line"
    STATIC = "static"


class LyricsSource(StrEnum):
    MANUAL = "manual"
    TTML = "ttml"
    LRC = "lrc"
    AUTO = "auto"


class MediaStatus(StrEnum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class PlaylistType(StrEnum):
    USER = "user"
    EDITORIAL = "editorial"
    GENERATED = "generated"


class GeneratedKind(StrEnum):
    DAILY = "daily"
    MIX = "mix"
    DISCOVER = "discover"
    RADAR = "radar"
    PREMIERE = "premiere"


class CoverMode(StrEnum):
    CUSTOM = "custom"
    COLLAGE = "collage"


class ExperimentStatus(StrEnum):
    DRAFT = "draft"
    RUNNING = "running"
    STOPPED = "stopped"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
