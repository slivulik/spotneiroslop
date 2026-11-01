"""Thin, typed wrappers around ffmpeg / ffprobe subprocesses."""

import json
import subprocess
from pathlib import Path
from typing import Any

from sonora_media.config import WorkerSettings
from sonora_media.errors import ToolError

_STDERR_TAIL = 2000


def run(
    args: list[str], *, timeout: int, input_bytes: bytes | None = None
) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, input=input_bytes, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ToolError(f"{Path(args[0]).name} timed out after {timeout}s") from exc
    except FileNotFoundError as exc:
        raise ToolError(f"{args[0]} is not installed") from exc
    if result.returncode != 0:
        tail = result.stderr.decode(errors="replace")[-_STDERR_TAIL:]
        raise ToolError(f"{Path(args[0]).name} exited with {result.returncode}: {tail}")
    return result


def ffmpeg(settings: WorkerSettings, *args: str, input_bytes: bytes | None = None) -> bytes:
    """Run ffmpeg quietly; returns stdout (used when piping raw PCM)."""
    cmd = [settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", *args]
    return run(cmd, timeout=settings.ffmpeg_timeout_seconds, input_bytes=input_bytes).stdout


def ffmpeg_stderr(settings: WorkerSettings, *args: str) -> str:
    """Run ffmpeg at info level and return stderr (filters like ebur128 report there)."""
    cmd = [settings.ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "info", "-y", *args]
    return run(cmd, timeout=settings.ffmpeg_timeout_seconds).stderr.decode(errors="replace")


def ffprobe_json(settings: WorkerSettings, path: Path) -> dict[str, Any]:
    cmd = [
        settings.ffprobe,
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]  # fmt: skip
    result = run(cmd, timeout=120)
    data: dict[str, Any] = json.loads(result.stdout)
    return data


def has_encoder(settings: WorkerSettings, name: str) -> bool:
    out = run([settings.ffmpeg, "-hide_banner", "-encoders"], timeout=30).stdout.decode()
    return any(line.split()[1:2] == [name] for line in out.splitlines() if line.startswith(" "))
