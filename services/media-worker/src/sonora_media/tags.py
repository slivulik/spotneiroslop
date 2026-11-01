"""Stage 3: read metadata from Vorbis comments (FLAC) and ID3 (MP3) into one shape."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import ID3
from mutagen.mp3 import MP3
from sonora_api.media.lyrics import SyncedLine, parse_lrc

from sonora_media.errors import MediaError

_FEAT_RE = re.compile(r"\s+(?:feat\.?|ft\.?|featuring)\s+", re.IGNORECASE)
_TITLE_FEAT_RE = re.compile(r"\s*[\(\[](?:feat\.?|ft\.?|featuring)\s+([^\)\]]+)[\)\]]", re.IGNORECASE)
_SPLIT_RE = re.compile(r"\s*(?:,|;|&|\s/\s)\s*")
_VERSION_RE = re.compile(
    r"\s*(?:[\(\[]([^\)\]]*\b(?:remix|mix|live|edit|version|acoustic|remaster(?:ed)?|instrumental|demo|"
    r"ремикс|версия|акустика|live-версия)\b[^\)\]]*)[\)\]]|\s-\s(.*\b(?:remix|mix|live|edit|version|remaster(?:ed)?)\b.*))$",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?")


@dataclass(slots=True)
class TrackTags:
    title: str | None = None
    version: str | None = None
    artists: list[str] = field(default_factory=list)
    featured: list[str] = field(default_factory=list)
    album: str | None = None
    album_artists: list[str] = field(default_factory=list)
    track_number: int | None = None
    track_total: int | None = None
    disc_number: int | None = None
    disc_total: int | None = None
    release_date: str | None = None  # ISO date; YYYY-01-01 when only the year is known
    genres: list[str] = field(default_factory=list)
    isrc: str | None = None
    upc: str | None = None
    label: str | None = None
    composers: list[str] = field(default_factory=list)
    lyricists: list[str] = field(default_factory=list)
    explicit: bool = False
    lyrics: str | None = None
    synced_lyrics: list[SyncedLine] = field(default_factory=list)
    replaygain_track_gain: float | None = None
    has_cover: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TrackTags:
        data = dict(data)
        data["synced_lyrics"] = [SyncedLine(**line) for line in data.get("synced_lyrics", [])]
        return cls(**data)


# ---------------------------------------------------------------------------
# Parsing helpers (pure, unit-tested)
# ---------------------------------------------------------------------------


def split_artists(values: list[str]) -> tuple[list[str], list[str]]:
    """Split artist credits into (main, featured), de-duplicated, order preserved."""
    main: list[str] = []
    feat: list[str] = []
    for value in values:
        head, *tail = _FEAT_RE.split(value, maxsplit=1)
        main += _SPLIT_RE.split(head)
        if tail:
            feat += _SPLIT_RE.split(tail[0])
    clean = lambda names: list(dict.fromkeys(n.strip() for n in names if n.strip()))  # noqa: E731
    main_clean = clean(main)
    return main_clean, [f for f in clean(feat) if f not in main_clean]


def split_title(raw: str) -> tuple[str, str | None, list[str]]:
    """'Song (feat. X) (Live)' → ('Song', 'Live', ['X'])."""
    featured: list[str] = []
    for match in _TITLE_FEAT_RE.finditer(raw):
        featured += [n.strip() for n in _SPLIT_RE.split(match.group(1)) if n.strip()]
    title = _TITLE_FEAT_RE.sub("", raw).strip()
    version = None
    version_match = _VERSION_RE.search(title)
    if version_match and version_match.start() > 0:
        version = (version_match.group(1) or version_match.group(2)).strip()
        title = title[: version_match.start()].strip()
    return title, version, featured


def parse_position(value: str | None) -> tuple[int | None, int | None]:
    """'3/12' → (3, 12); '3' → (3, None)."""
    if not value:
        return None, None
    number, _, total = str(value).partition("/")
    as_int = lambda v: int(v) if v.strip().isdigit() and int(v) > 0 else None  # noqa: E731
    return as_int(number), as_int(total)


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    match = _YEAR_RE.match(value.strip())
    if not match:
        return None
    year, month, day = int(match.group(1)), int(match.group(2) or 1), int(match.group(3) or 1)
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return date(year, 1, 1).isoformat()


def parse_gain(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(str(value).lower().replace("db", "").strip())
    except ValueError:
        return None


def _is_explicit(value: str | None) -> bool:
    # iTunes advisory: 1 = explicit, 2 = clean, 0 = none.
    return str(value or "").strip().lower() in {"1", "4", "explicit", "true", "yes", "e"}


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _Raw:
    """Format-neutral view of the tags; values are lists of strings."""

    values: dict[str, list[str]]
    lyrics: str | None
    synced: list[SyncedLine]

    def first(self, *keys: str) -> str | None:
        for key in keys:
            if self.values.get(key):
                return self.values[key][0]
        return None

    def all(self, *keys: str) -> list[str]:
        out: list[str] = []
        for key in keys:
            out += self.values.get(key, [])
        return out


def _read_flac(audio: FLAC) -> _Raw:
    values: dict[str, list[str]] = {}
    comments: list[tuple[str, str]] = list(audio.tags or [])  # type: ignore[arg-type]  # VCFLACDict is iterable
    for key, value in comments:
        values.setdefault(key.upper(), []).append(value)
    lyrics = None
    for key in ("LYRICS", "UNSYNCEDLYRICS", "UNSYNCED LYRICS"):
        if values.get(key):
            lyrics = values[key][0]
            break
    return _Raw(values=values, lyrics=lyrics, synced=[])


_ID3_MAP = {
    "TIT2": "TITLE", "TPE1": "ARTIST", "TPE2": "ALBUMARTIST", "TALB": "ALBUM", "TRCK": "TRACKNUMBER",
    "TPOS": "DISCNUMBER", "TDRC": "DATE", "TDRL": "RELEASEDATE", "TCON": "GENRE", "TSRC": "ISRC",
    "TCOM": "COMPOSER", "TEXT": "LYRICIST", "TPUB": "LABEL",
}  # fmt: skip


def _read_id3(tags: ID3) -> _Raw:
    values: dict[str, list[str]] = {}
    for frame_id, key in _ID3_MAP.items():
        for frame in tags.getall(frame_id):
            values.setdefault(key, []).extend(str(t) for t in frame.text)
    for frame in tags.getall("TXXX"):
        values.setdefault(frame.desc.upper(), []).extend(str(t) for t in frame.text)
    lyrics = next((frame.text for frame in tags.getall("USLT") if frame.text.strip()), None)
    synced: list[SyncedLine] = []
    for frame in tags.getall("SYLT"):
        if frame.format == 2:  # timestamps in milliseconds
            synced = [SyncedLine(start_ms=int(ms), text=str(text).strip()) for text, ms in frame.text]
            break
    return _Raw(values=values, lyrics=lyrics, synced=synced)


def read_tags(path: Path) -> TrackTags:
    try:
        audio = mutagen.File(path)
    except mutagen.MutagenError as exc:
        raise MediaError(f"Не удалось прочитать теги: {exc}") from exc
    if isinstance(audio, FLAC):
        raw = _read_flac(audio)
        has_cover = bool(audio.pictures)
    elif isinstance(audio, MP3):
        raw = _read_id3(audio.tags) if audio.tags is not None else _Raw({}, None, [])
        has_cover = bool(audio.tags and audio.tags.getall("APIC"))
    else:
        raise MediaError("Теги в этом формате не читаются")

    tags = TrackTags(has_cover=has_cover)
    raw_title = raw.first("TITLE")
    if raw_title:
        tags.title, tags.version, title_feat = split_title(raw_title)
    else:
        title_feat = []
    tags.artists, featured = split_artists(raw.all("ARTIST"))
    tags.featured = list(dict.fromkeys(f for f in [*featured, *title_feat] if f not in tags.artists))
    tags.album = raw.first("ALBUM")
    tags.album_artists, _ = split_artists(raw.all("ALBUMARTIST", "ALBUM ARTIST"))
    tags.track_number, tags.track_total = parse_position(raw.first("TRACKNUMBER"))
    tags.track_total = tags.track_total or parse_position(raw.first("TRACKTOTAL", "TOTALTRACKS"))[0]
    tags.disc_number, tags.disc_total = parse_position(raw.first("DISCNUMBER"))
    tags.disc_total = tags.disc_total or parse_position(raw.first("DISCTOTAL", "TOTALDISCS"))[0]
    tags.release_date = parse_date(raw.first("RELEASEDATE", "DATE", "ORIGINALDATE", "YEAR"))
    tags.genres = list(
        dict.fromkeys(g.strip() for v in raw.all("GENRE") for g in _SPLIT_RE.split(v) if g.strip())
    )
    isrc = raw.first("ISRC")
    tags.isrc = isrc.replace("-", "").upper()[:12] if isrc else None
    upc = raw.first("BARCODE", "UPC", "EAN")
    tags.upc = re.sub(r"\D", "", upc)[:14] or None if upc else None
    tags.label = raw.first("LABEL", "ORGANIZATION", "PUBLISHER")
    tags.composers = raw.all("COMPOSER")
    tags.lyricists = raw.all("LYRICIST", "WRITER")
    tags.explicit = _is_explicit(raw.first("ITUNESADVISORY", "EXPLICIT", "RATING"))
    tags.replaygain_track_gain = parse_gain(raw.first("REPLAYGAIN_TRACK_GAIN"))

    tags.synced_lyrics = raw.synced
    if raw.lyrics:
        lrc = parse_lrc(raw.lyrics)
        if lrc and not tags.synced_lyrics:
            tags.synced_lyrics = lrc
        else:
            tags.lyrics = raw.lyrics.strip() or None
    return tags


def embedded_cover(path: Path) -> bytes | None:
    """Front cover if present, otherwise the first picture."""
    audio = mutagen.File(path)
    pictures: list[tuple[int, bytes]] = []
    if isinstance(audio, FLAC):
        pictures = [(p.type, p.data) for p in audio.pictures]
    elif isinstance(audio, MP3) and audio.tags is not None:
        pictures = [(frame.type, frame.data) for frame in audio.tags.getall("APIC")]
    if not pictures:
        return None
    front = [data for kind, data in pictures if kind == 3]
    return front[0] if front else pictures[0][1]
