import uuid
from typing import Any

from sonora_api.core.ids import uuid7
from sonora_api.models import Track, TrackFeatures, TrackFile
from sonora_api.models.enums import Quality
from sonora_api.services.streaming import STREAM_PATH_RE, inline_segment_urls
from tests.conftest import Catalog, Harness, bearer, register

MEDIA = "sonora-media"


async def _make_streamable(harness: Harness, track: Track, qualities: list[Quality]) -> str:
    prefix = f"tracks/{track.id}/{uuid.uuid4()}/hls"
    async with harness.ctx.sessionmaker() as s:
        row = await s.get(Track, track.id)
        assert row is not None
        row.hls_master_key = f"{prefix}/master.m3u8"
        row.preview_key = f"tracks/{track.id}/job/preview.m4a"
        row.track_gain, row.album_gain = -2.5, -3.0
        for q in qualities:
            codec = "flac" if q in {Quality.HIRES, Quality.LOSSLESS} else "aac"
            s.add(
                TrackFile(
                    id=uuid7(),
                    track_id=track.id,
                    quality=q,
                    codec=codec,
                    sample_rate=44_100,
                    storage_key=f"x/{q.value}",
                    size_bytes=1,
                    checksum_sha256="0" * 64,
                )
            )
        await s.commit()
    harness.storage.contents[(MEDIA, f"{prefix}/master.m3u8")] = b"#EXTM3U\nnormal/playlist.m3u8\n"
    harness.storage.contents[(MEDIA, f"{prefix}/lossless/playlist.m3u8")] = (
        b"#EXTM3U\ninit.mp4\nseg_00000.m4s\n"
    )
    return prefix


async def test_stream_requires_auth_and_clamps_quality(harness: Harness, catalog_data: Catalog) -> None:
    track = catalog_data.tracks[1]
    prefix = await _make_streamable(
        harness, track, [Quality.LOSSLESS, Quality.HIGH, Quality.NORMAL, Quality.LOW]
    )
    url = f"/v1/tracks/{track.id}/stream"
    assert (await harness.client.get(url)).status_code == 401

    tokens = await register(harness.client)
    auto = (await harness.client.get(url, headers=bearer(tokens))).json()
    assert auto["quality"] == "auto"
    assert auto["url"].endswith("/master.m3u8")
    assert auto["qualities"] == ["lossless", "high", "normal", "low"]
    assert (auto["track_gain"], auto["album_gain"]) == (-2.5, -3.0)
    assert auto["expires_in"] >= 3600
    assert auto["waveform"] is None  # not analysed yet

    async with harness.ctx.sessionmaker() as s:
        s.add(TrackFeatures(track_id=track.id, waveform=[(i * 7) % 256 for i in range(800)]))
        await s.commit()
    peaks = (await harness.client.get(url, headers=bearer(tokens))).json()["waveform"]
    assert len(peaks) == 160
    assert peaks[0] == max((i * 7) % 256 for i in range(5))

    hires = (await harness.client.get(url, headers=bearer(tokens), params={"quality": "hires"})).json()
    assert (hires["quality"], hires["codec"]) == ("lossless", "flac")  # no Hi-Res master → best below

    # The playlist is served by the API so relative segment URIs come back here.
    playlist = await harness.client.get(hires["url"])
    assert playlist.status_code == 200
    assert playlist.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    # Segments are inlined as direct storage links: one round trip per segment, not two.
    seg_base = f"https://s3.test/{MEDIA}/{prefix}/lossless"
    assert (
        playlist.text
        == f"#EXTM3U\n{seg_base}/init.mp4?ttl=10800&sig=1\n{seg_base}/seg_00000.m4s?ttl=10800&sig=1\n"
    )
    assert [r["quality"] for r in hires["renditions"]] == ["lossless", "high", "normal", "low"]
    assert hires["renditions"][0]["codec"]

    # Segments redirect to short-lived presigned storage URLs.
    base = hires["url"].rsplit("/", 1)[0]
    segment = await harness.client.get(f"{base}/seg_00000.m4s")
    assert segment.status_code == 302
    assert (
        segment.headers["location"]
        == f"https://s3.test/{MEDIA}/{prefix}/lossless/seg_00000.m4s?ttl=300&sig=1"
    )
    assert segment.headers["cache-control"] == "private, no-store"


async def test_stream_paths_are_locked_down(harness: Harness, catalog_data: Catalog) -> None:
    track = catalog_data.tracks[0]
    await _make_streamable(harness, track, [Quality.HIGH])
    tokens = await register(harness.client)
    stream: dict[str, Any] = (
        await harness.client.get(f"/v1/tracks/{track.id}/stream", headers=bearer(tokens))
    ).json()
    token = stream["url"].split("/")[3]
    for bad in ("high/secret.flac", "files/high.m4a", "high/seg_1.m4s", "ultra/playlist.m3u8"):
        assert (await harness.client.get(f"/v1/stream/{token}/{bad}")).status_code == 404, bad
    # `..` is normalised away by clients, but the allow-list rejects it regardless.
    for traversal in ("../other/master.m3u8", "high/../../x/playlist.m3u8", "high/%2e%2e/init.mp4"):
        assert not STREAM_PATH_RE.match(traversal)
    tampered = await harness.client.get(f"/v1/stream/{token[:-2]}xx/master.m3u8")
    assert tampered.status_code == 403
    assert tampered.json()["error"]["code"] == "invalid_stream_token"
    # An access token must not work as a stream token (separate keys).
    assert (await harness.client.get(f"/v1/stream/{tokens['access_token']}/master.m3u8")).status_code == 403


async def test_explicit_filter_blocks_stream(harness: Harness, catalog_data: Catalog) -> None:
    track = catalog_data.explicit_track
    await _make_streamable(harness, track, [Quality.HIGH])
    tokens = await register(harness.client)
    await harness.client.patch("/v1/me", headers=bearer(tokens), json={"explicit_filter": True})
    response = await harness.client.get(f"/v1/tracks/{track.id}/stream", headers=bearer(tokens))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "explicit_filtered"


async def test_preview_is_public_and_hidden_tracks_404(harness: Harness, catalog_data: Catalog) -> None:
    track = catalog_data.tracks[0]
    await _make_streamable(harness, track, [Quality.HIGH])
    preview = await harness.client.get(f"/v1/tracks/{track.id}/preview")
    assert preview.status_code == 302
    assert "preview.m4a" in preview.headers["location"]
    assert (
        await harness.client.get(f"/v1/tracks/{catalog_data.processing_track.id}/preview")
    ).status_code == 404
    unstreamable = await harness.client.get(
        f"/v1/tracks/{catalog_data.tracks[2].id}/stream", headers=bearer(await register(harness.client))
    )
    assert unstreamable.status_code == 404  # no HLS yet


async def test_new_releases(harness: Harness, catalog_data: Catalog) -> None:
    page = (await harness.client.get("/v1/releases", params={"limit": 1})).json()
    assert [r["title"] for r in page["items"]] == ["Afterglow"]
    rest = (await harness.client.get("/v1/releases", params={"cursor": page["next_cursor"]})).json()
    # Embargoed and empty releases never show up.
    assert [r["title"] for r in rest["items"]] == ["Tides"]
    assert rest["next_cursor"] is None


def test_inline_segment_urls_rewrites_init_and_segments_only() -> None:
    media = (
        '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.mp4"\n'
        "#EXTINF:6.0,\nseg_00000.m4s\n#EXTINF:2.5,\nseg_00001.m4s\n#EXT-X-ENDLIST\n"
    )
    out = inline_segment_urls(media, lambda name: f"https://s/{name}?sig")
    assert '#EXT-X-MAP:URI="https://s/init.mp4?sig"' in out
    assert "\nhttps://s/seg_00000.m4s?sig\n" in out
    assert "\nhttps://s/seg_00001.m4s?sig\n" in out
    assert "#EXTINF:6.0," in out
    assert out.endswith("#EXT-X-ENDLIST\n")
    master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhigh/playlist.m3u8\n"
    assert inline_segment_urls(master, lambda name: "x") == master
