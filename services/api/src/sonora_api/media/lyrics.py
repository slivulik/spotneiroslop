"""Lyrics documents (provisional v1, until packages/lyrics-core is specified).

    static: {"version": 1, "type": "static", "text": "..."}
    line:   {"version": 1, "type": "line", "lines": [{"start_ms", "end_ms", "text"}, ...]}

Produced from embedded tags by the media worker and from the admin editor (plain text or LRC).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_LRC_LINE_RE = re.compile(r"^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$")
_LRC_TS_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
DOCUMENT_VERSION = 1


@dataclass(frozen=True, slots=True)
class SyncedLine:
    start_ms: int
    text: str


def parse_lrc(text: str) -> list[SyncedLine]:
    """Line-synced LRC (`[mm:ss.xx] text`, several stamps per line allowed)."""
    lines: list[SyncedLine] = []
    for raw in text.splitlines():
        match = _LRC_LINE_RE.match(raw)
        if not match:
            continue
        for ts in _LRC_TS_RE.finditer(match.group(1)):
            minutes, seconds, frac = int(ts.group(1)), int(ts.group(2)), ts.group(3) or "0"
            ms = minutes * 60_000 + seconds * 1000 + int(frac.ljust(3, "0")[:3])
            lines.append(SyncedLine(start_ms=ms, text=match.group(2).strip()))
    return sorted(lines, key=lambda line: line.start_ms)


def line_document(lines: list[SyncedLine], duration_ms: int) -> dict[str, Any]:
    return {
        "version": DOCUMENT_VERSION,
        "type": "line",
        "lines": [
            {
                "start_ms": line.start_ms,
                "end_ms": lines[i + 1].start_ms if i + 1 < len(lines) else max(duration_ms, line.start_ms),
                "text": line.text,
            }
            for i, line in enumerate(lines)
        ],
    }


def static_document(text: str) -> dict[str, Any]:
    return {"version": DOCUMENT_VERSION, "type": "static", "text": text.strip()}


def to_lrc(document: dict[str, Any]) -> str:
    """Line document back to LRC, so the admin editor can round-trip synced lyrics."""
    out = []
    for line in document.get("lines", []):
        ms = int(line["start_ms"])
        out.append(f"[{ms // 60000:02d}:{ms // 1000 % 60:02d}.{ms % 1000 // 10:02d}]{line['text']}")
    return "\n".join(out)
