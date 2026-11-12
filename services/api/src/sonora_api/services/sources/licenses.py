"""Licence URLs → readable codes. Only Creative Commons licences and public-domain tools pass;
everything else ("all rights reserved", custom terms, missing or malformed URLs) is rejected."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

_CC_HOSTS = frozenset({"creativecommons.org", "www.creativecommons.org"})
#: Licence elements in canonical order (BY-NC-SA, BY-NC-ND …).
_ELEMENTS = ("by", "nc", "nd", "sa")
_VERSIONS = frozenset({"1.0", "2.0", "2.1", "2.5", "3.0", "4.0"})


@dataclass(frozen=True, slots=True)
class License:
    #: Readable code: "CC BY-SA 4.0", "CC BY-NC-ND 3.0 DE", "CC0 1.0", "Public Domain Mark 1.0".
    code: str
    #: Canonical https URL of the licence deed.
    url: str | None


def _path_segments(url: str) -> list[str] | None:
    """Lower-cased path segments of a creativecommons.org URL; None for any other site."""
    raw = url.strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = f"https://{raw.lstrip('/')}"
    try:
        parts = urlsplit(raw)
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if parts.scheme.lower() not in {"http", "https"} or host not in _CC_HOSTS or parts.username:
        return None
    return [s for s in parts.path.lower().split("/") if s]


def _cc_license(kind: str, version: str, rest: list[str]) -> License | None:
    elements = kind.split("-")
    if not elements or any(e not in _ELEMENTS for e in elements) or len(set(elements)) != len(elements):
        return None
    if "nd" in elements and "sa" in elements:  # mutually exclusive: not a real licence
        return None
    if version not in _VERSIONS:
        return None
    # A third segment is a jurisdiction port ("de", "us", "scotland"), unless it is the deed page.
    port = rest[0] if rest and not rest[0].startswith(("legalcode", "deed")) else None
    if port is not None and not (port.isascii() and port.isalpha() and len(port) <= 10):
        return None
    canonical = "-".join(e.upper() for e in _ELEMENTS if e in elements)
    code = f"CC {canonical} {version}" + (f" {port.upper()}" if port else "")
    url = f"https://creativecommons.org/licenses/{kind}/{version}/" + (f"{port}/" if port else "")
    return License(code=code, url=url)


def _public_domain(path: list[str]) -> License | None:
    match path:
        case ["licenses", "publicdomain", *_]:
            return License(code="Public Domain", url="https://creativecommons.org/licenses/publicdomain/")
        case ["publicdomain", "zero", version, *_] if version in _VERSIONS:
            return License(
                code=f"CC0 {version}", url=f"https://creativecommons.org/publicdomain/zero/{version}/"
            )
        case ["publicdomain", "mark", version, *_] if version in _VERSIONS:
            return License(
                code=f"Public Domain Mark {version}",
                url=f"https://creativecommons.org/publicdomain/mark/{version}/",
            )
    return None


def parse_license(url: str | None) -> License | None:
    """Readable licence for a Creative Commons / public-domain URL, or None (= not free)."""
    path = _path_segments(url) if url else None
    if not path:
        return None
    if (public_domain := _public_domain(path)) is not None:
        return public_domain
    if path[0] == "licenses" and len(path) >= 3:
        return _cc_license(path[1], path[2], path[3:])
    return None


def first_license(value: object) -> License | None:
    """Archive metadata may hold one URL or a list of them: the first free licence wins."""
    if isinstance(value, str):
        return parse_license(value)
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and (found := parse_license(item)) is not None:
                return found
    return None
