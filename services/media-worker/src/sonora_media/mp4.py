"""Minimal ISO-BMFF editing: fix the edit list in fMP4 init segments for gapless playback.

ffmpeg's HLS fMP4 muxer writes `elst` with media_time = 0, dropping the encoder priming that
the source .m4a trims. Players (Safari, ExoPlayer, Chrome MSE) honour a single-entry edit list,
so we rewrite it in place: media_time = priming samples (media timescale), segment_duration =
real duration (movie timescale), which also trims the padding at the end.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from pathlib import Path

_CONTAINERS = {b"moov", b"trak", b"edts", b"mdia", b"minf", b"stbl"}


def _boxes(
    data: bytes | bytearray, start: int = 0, end: int | None = None
) -> Iterator[tuple[bytes, int, int]]:
    """Yield (type, offset, size) for every box, depth-first through known containers."""
    end = len(data) if end is None else end
    offset = start
    while offset + 8 <= end:
        size, kind = struct.unpack(">I4s", data[offset : offset + 8])
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[offset + 8 : offset + 16])[0]
            header = 16
        elif size == 0:
            size = end - offset
        if size < header:
            raise ValueError(f"corrupt box {kind!r} at {offset}")
        yield kind, offset, size
        if kind in _CONTAINERS:
            yield from _boxes(data, offset + header, offset + size)
        offset += size


def _timescale(data: bytearray, offset: int) -> int:
    """Timescale field of an mvhd/mdhd full box."""
    version = data[offset + 8]
    pos = offset + 12 + (16 if version == 1 else 8)
    return int(struct.unpack(">I", data[pos : pos + 4])[0])


def set_edit_list(init: Path, *, priming_samples: int, duration_s: float) -> None:
    data = bytearray(init.read_bytes())
    movie_ts = media_ts = 0
    elst: int | None = None
    for kind, offset, _ in _boxes(data):
        if kind == b"mvhd":
            movie_ts = _timescale(data, offset)
        elif kind == b"mdhd" and not media_ts:
            media_ts = _timescale(data, offset)
        elif kind == b"elst" and elst is None:
            elst = offset
    if elst is None or not movie_ts or not media_ts:
        raise ValueError(f"{init.name}: no edit list / timescales to patch")

    version = data[elst + 8]
    (count,) = struct.unpack(">I", data[elst + 12 : elst + 16])
    if count != 1:
        raise ValueError(f"{init.name}: expected a single edit list entry, found {count}")
    entry = elst + 16
    segment_duration = round(duration_s * movie_ts)
    # Priming is counted in the AAC sample rate, which equals the media timescale.
    if version == 1:
        struct.pack_into(">Qq", data, entry, segment_duration, priming_samples)
    else:
        struct.pack_into(">Ii", data, entry, segment_duration, priming_samples)
    init.write_bytes(bytes(data))


def read_edit_list(init: Path) -> tuple[int, int]:
    """(segment_duration, media_time) of the first edit list entry."""
    data = bytearray(init.read_bytes())
    for kind, offset, _ in _boxes(data):
        if kind == b"elst":
            fmt = ">Qq" if data[offset + 8] == 1 else ">Ii"
            duration, media_time = struct.unpack(fmt, data[offset + 16 : offset + 16 + struct.calcsize(fmt)])
            return int(duration), int(media_time)
    raise ValueError("no elst box")
