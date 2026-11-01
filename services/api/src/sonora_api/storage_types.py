CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".m4s": "audio/mp4",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".avif": "image/avif",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


def content_type_for(name: str) -> str:
    dot = name.rfind(".")
    return (
        CONTENT_TYPES.get(name[dot:].lower(), "application/octet-stream")
        if dot >= 0
        else "application/octet-stream"
    )
