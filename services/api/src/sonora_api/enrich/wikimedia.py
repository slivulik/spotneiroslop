"""Wikidata → Commons photo (free licence, credited) and Wikipedia summary (CC BY-SA)."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

import httpx

from sonora_api.enrich.common import client

WIKIDATA = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/{name}?width=1200"
COMMONS_PAGE = "https://commons.wikimedia.org/wiki/File:{name}"
SUMMARY = "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"


@dataclass(frozen=True)
class ArtistInfo:
    photo: bytes | None
    photo_credit: str | None
    bio: str | None
    bio_source: str | None


def artist_info(qid: str, *, transport: httpx.BaseTransport | None = None) -> ArtistInfo | None:
    try:
        with client(transport) as http:
            r = http.get(WIKIDATA.format(qid=qid))
            if r.status_code != 200:
                return None
            entity = r.json().get("entities", {}).get(qid, {})
            photo = credit = bio = bio_source = None
            images = entity.get("claims", {}).get("P18", [])
            if images:
                name = images[0]["mainsnak"]["datavalue"]["value"].replace(" ", "_")
                img = http.get(COMMONS_FILE.format(name=quote(name)))
                if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                    photo = img.content
                    credit = COMMONS_PAGE.format(name=quote(name))
            for lang in ("ru", "en"):
                site = entity.get("sitelinks", {}).get(f"{lang}wiki")
                if not site:
                    continue
                s = http.get(SUMMARY.format(lang=lang, title=quote(site["title"].replace(" ", "_"))))
                if s.status_code == 200 and s.json().get("extract"):
                    bio = s.json()["extract"].strip()
                    bio_source = s.json().get("content_urls", {}).get("desktop", {}).get("page")
                    break
            return ArtistInfo(photo, credit, bio, bio_source)
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        return None
