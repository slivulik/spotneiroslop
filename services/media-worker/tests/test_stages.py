from pathlib import Path

import pytest
from PIL import Image
from sonora_api.media import blurhash

from sonora_media import artwork, authenticity, fingerprint, loudness, preview, transcode, waveform
from sonora_media.config import WorkerSettings
from sonora_media.errors import MediaError
from sonora_media.ladder import plan_ladder
from sonora_media.mp4 import read_edit_list
from sonora_media.probe import probe
from sonora_media.tags import embedded_cover, read_tags
from sonora_media.tools import ffprobe_json
from tests.conftest import AudioFiles, cover_png


def test_probe(settings: WorkerSettings, audio: AudioFiles) -> None:
    hires = probe(settings, audio.flac24)
    assert (hires.codec, hires.sample_rate, hires.bit_depth, hires.channels) == ("flac", 96_000, 24, 2)
    assert 19_900 <= hires.duration_ms <= 20_100
    mp3 = probe(settings, audio.mp3)
    assert (mp3.codec, mp3.bit_depth, mp3.is_lossless) == ("mp3", None, False)
    assert mp3.bitrate is not None
    assert mp3.bitrate >= 300_000


def test_probe_rejects_bad_files(settings: WorkerSettings, audio: AudioFiles) -> None:
    with pytest.raises(MediaError, match="повреждён"):
        probe(settings, audio.corrupt)
    with pytest.raises(MediaError):
        probe(settings, audio.not_audio)


def test_authenticity(settings: WorkerSettings, audio: AudioFiles) -> None:
    genuine = authenticity.analyze(settings, audio.flac16, probe(settings, audio.flac16))
    assert not genuine.suspicious
    assert genuine.cutoff_hz > 20_000
    fake = authenticity.analyze(settings, audio.fake_lossless, probe(settings, audio.fake_lossless))
    assert fake.suspicious
    assert fake.cutoff_hz < 18_000
    lossy = authenticity.analyze(settings, audio.mp3, probe(settings, audio.mp3))
    assert not lossy.suspicious  # only lossless files are judged


def test_tags_flac(audio: AudioFiles) -> None:
    tags = read_tags(audio.flac24)
    assert (tags.title, tags.version) == ("Морской ветер", "Live")
    assert tags.artists == ["Night Shore", "Second Hand"]
    assert tags.featured == ["Guest Voice"]
    assert tags.album_artists == ["Night Shore"]
    assert (tags.track_number, tags.track_total) == (2, 10)
    assert tags.release_date == "2025-05-01"
    assert tags.genres == ["Indie", "Rock"]
    assert tags.isrc == "RUA012500001"
    assert tags.composers == ["A. Composer"]
    assert [line.text for line in tags.synced_lyrics] == ["Первая строка", "Second line", "Третья"]
    assert tags.lyrics is None
    assert tags.has_cover
    cover = embedded_cover(audio.flac24)
    assert cover is not None
    assert cover.startswith(b"\x89PNG")


def test_tags_mp3(audio: AudioFiles) -> None:
    tags = read_tags(audio.mp3)
    assert (tags.title, tags.artists, tags.album) == ("MP3 Song", ["Lame Band"], "Lossy LP")
    assert tags.lyrics == "Просто текст\nбез таймкодов"
    assert tags.synced_lyrics == []
    assert tags.has_cover


def test_fingerprint_matches_same_recording_only(
    settings: WorkerSettings, audio: AudioFiles, tmp_path: Path
) -> None:
    reencoded = tmp_path / "same.mp3"
    from tests.conftest import sh  # noqa: PLC0415

    sh("-i", str(audio.flac16), "-c:a", "libmp3lame", "-b:a", "192k", str(reencoded))
    original = fingerprint.chromaprint(settings, audio.flac16)
    assert fingerprint.decode(fingerprint.encode(original)).tolist() == original.tolist()
    assert fingerprint.similarity(original, fingerprint.chromaprint(settings, reencoded)) >= 0.99
    assert fingerprint.is_informative(original)
    assert fingerprint.similarity(original, fingerprint.chromaprint(settings, audio.other_flac)) < 0.75
    assert len(fingerprint.sha256_file(audio.flac16)) == 64


def test_loudness_measure(settings: WorkerSettings, audio: AudioFiles) -> None:
    result = loudness.measure(settings, audio.flac16)
    assert -40 < result.integrated_lufs < 0
    expected = loudness.replay_gain(result.integrated_lufs, result.true_peak_db, target=-14, ceiling=-1)
    assert result.track_gain == expected
    assert result.true_peak_db + result.track_gain <= -1 + 0.01


def test_transcode_ladder_and_hls(settings: WorkerSettings, audio: AudioFiles, tmp_path: Path) -> None:
    source = probe(settings, audio.flac24)
    encoded = [
        transcode.encode(settings, audio.flac24, source, r, tmp_path)
        for r in plan_ladder(source, has_fdk_aac=False)
    ]
    by_quality = {e.rendition.quality.value: e for e in encoded}
    assert set(by_quality) == {"hires", "lossless", "high", "normal", "low"}

    def stream(path: Path) -> dict[str, object]:
        return next(s for s in ffprobe_json(settings, path)["streams"] if s["codec_type"] == "audio")

    hires, lossless, high = (stream(by_quality[q].file) for q in ("hires", "lossless", "high"))
    assert (hires["sample_rate"], hires["bits_per_raw_sample"]) == ("96000", "24")
    assert (lossless["sample_rate"], lossless["sample_fmt"]) == ("44100", "s16")
    assert (high["codec_name"], high["sample_rate"]) == ("aac", "48000")
    assert by_quality["high"].encoder_delay == 1024
    assert by_quality["lossless"].encoder_delay == 0
    # Gapless: the HLS init segment trims AAC priming and padding like the source .m4a does.
    duration, media_time = read_edit_list(by_quality["high"].hls_dir / "init.mp4")
    assert media_time == 1024
    assert duration == round(source.duration_ms / 1000 * 1000)  # ffmpeg's movie timescale is 1000

    for e in encoded:
        playlist = (e.hls_dir / "playlist.m3u8").read_text()
        assert '#EXT-X-MAP:URI="init.mp4"' in playlist
        assert "#EXT-X-ENDLIST" in playlist
        assert len(list(e.hls_dir.glob("seg_*.m4s"))) >= 3  # 20 s / 6 s segments
        assert e.peak_bitrate >= e.average_bitrate > 0

    master = transcode.master_playlist(encoded)
    assert master.index("normal/playlist.m3u8") < master.index("low/playlist.m3u8") < master.index("high/")
    assert "lossless" not in master
    assert "hires" not in master
    assert 'CODECS="mp4a.40.2"' in master


def test_mp3_high_tier_is_the_untouched_source(
    settings: WorkerSettings, audio: AudioFiles, tmp_path: Path
) -> None:
    source = probe(settings, audio.mp3)
    high = plan_ladder(source, has_fdk_aac=False)[0]
    encoded = transcode.encode(settings, audio.mp3, source, high, tmp_path)
    assert encoded.file.read_bytes() == audio.mp3.read_bytes()
    assert encoded.encoder_delay > 0  # LAME header from libmp3lame
    assert 'CODECS="mp4a.40.34"' in transcode.master_playlist([encoded])


def test_waveform_and_preview(settings: WorkerSettings, audio: AudioFiles, tmp_path: Path) -> None:
    peaks = waveform.compute(settings, audio.flac16)
    assert len(peaks) == waveform.PEAKS
    assert max(peaks) == 255
    assert min(peaks) >= 0
    out = tmp_path / "preview.m4a"
    start = preview.render(settings, audio.flac16, 15_000, out)
    assert start == 0  # shorter than 30 s → the whole track
    duration = float(ffprobe_json(settings, out)["format"]["duration"])
    assert 14.5 <= duration <= 15.5


def test_artwork(tmp_path: Path) -> None:
    result = artwork.process(cover_png(1400), tmp_path)
    assert result.source_size == 1400
    assert len(result.files) == len(artwork.SIZES) * len(artwork.FORMATS)
    with Image.open(result.files["300.avif"]) as img:
        assert img.size == (300, 300)
    with Image.open(result.files["3000.webp"]) as img:
        assert img.size == (1400, 1400)  # never upscaled
    palette = result.palette
    assert palette.dominant == "#142878"  # the blue background
    assert palette.text == "#F5F5F7"  # light text on dark blue
    assert artwork.contrast((245, 245, 247), (0x14, 0x28, 0x78)) >= artwork.WCAG_AA


def test_artwork_rejects_garbage(tmp_path: Path) -> None:
    with pytest.raises(MediaError, match="не читается"):
        artwork.process(b"not an image", tmp_path)


def test_blurhash_encodes_average_colour() -> None:
    image = Image.new("RGB", (64, 64), (200, 30, 30))
    value = blurhash.encode(image)
    assert len(value) == 6 + 2 * (4 * 3 - 1)
    dc = 0
    for ch in value[2:6]:
        dc = dc * 83 + blurhash._CHARS.index(ch)
    assert ((dc >> 16) & 255, (dc >> 8) & 255, dc & 255) == (200, 30, 30)


def test_degenerate_fingerprints_are_not_informative(settings: WorkerSettings, tmp_path: Path) -> None:
    from tests.conftest import sh  # noqa: PLC0415

    tone_a, tone_b = tmp_path / "a.flac", tmp_path / "b.flac"
    sh("-f", "lavfi", "-i", "sine=f=330:d=30", str(tone_a))
    sh("-f", "lavfi", "-i", "sine=f=392:d=30", str(tone_b))
    a, b = fingerprint.chromaprint(settings, tone_a), fingerprint.chromaprint(settings, tone_b)
    # Steady tones produce near-constant fingerprints that look alike: never use them to block.
    assert not fingerprint.is_informative(a)
    assert not fingerprint.is_informative(b)


def test_missing_ffmpeg_is_not_blamed_on_the_file(audio: AudioFiles, tmp_path: Path) -> None:
    from sonora_media.errors import ToolMissingError  # noqa: PLC0415
    from sonora_media.tools import check_tools  # noqa: PLC0415
    from tests.conftest import make_settings  # noqa: PLC0415

    broken = make_settings(tmp_path).model_copy(update={"ffprobe": "/nonexistent/ffprobe"})
    with pytest.raises(ToolMissingError):
        probe(broken, audio.flac16)
    with pytest.raises(ToolMissingError):
        check_tools(broken)
