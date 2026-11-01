class MediaError(Exception):
    """A problem with the media itself (corrupt, unsupported). Retrying won't help; the
    message is shown to the admin as-is."""


class ToolError(Exception):
    """An external tool (ffmpeg/ffprobe) failed unexpectedly. May be transient."""
