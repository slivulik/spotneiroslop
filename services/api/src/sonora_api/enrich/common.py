from __future__ import annotations

import re
import threading
import time
import unicodedata

import httpx

USER_AGENT = "Sonora/0.1 (self-hosted music streaming; https://github.com/slivulik/spotneiroslop)"
TIMEOUT = httpx.Timeout(8.0, connect=5.0)


def client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=TIMEOUT,
        follow_redirects=True,
        transport=transport,
    )


_NOISE = re.compile(
    r"\s*[\(\[](feat\.?|ft\.?|при уч\.?|remaster(ed)?|\d{4} remaster|deluxe|explicit|clean)[^\)\]]*[\)\]]",
    re.I,
)


def normalize(text: str | None) -> str:
    """Case-, accent- and punctuation-insensitive key; drops "(feat. …)", "(Remastered)" etc."""
    if not text:
        return ""
    t = _NOISE.sub("", text)
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace("ё", "е").replace("&", " and ")
    t = re.sub(r"[^\w]+", " ", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def same(a: str | None, b: str | None) -> bool:
    return bool(normalize(a)) and normalize(a) == normalize(b)


class RateLimit:
    """At most one request per `interval` seconds (MusicBrainz asks for 1 req/s)."""

    def __init__(self, interval: float) -> None:
        self.interval = interval
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            delay = self._last + self.interval - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self._last = time.monotonic()
