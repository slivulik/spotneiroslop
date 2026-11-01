import math

import numpy as np
import pytest
from sonora_api.core.slugs import slugify
from sonora_api.media.lyrics import parse_lrc
from sonora_api.models.enums import Quality

from sonora_media.ladder import plan_ladder
from sonora_media.loudness import album_gain, parse_ebur128, replay_gain
from sonora_media.preview import best_window_start_ms
from sonora_media.probe import ProbeResult
from sonora_media.tags import parse_date, parse_position, split_artists, split_title
from sonora_media.transcode import mp3_gapless
from sonora_media.waveform import peaks


def _probe(codec: str, rate: int, depth: int | None, bitrate: int | None = None) -> ProbeResult:
    return ProbeResult(codec, 200_000, rate, 2, depth, bitrate, 0)


@pytest.mark.parametrize(
    ("raw", "main", "feat"),
    [
        (["Main & Second"], ["Main", "Second"], []),
        (["A, B feat. C & D"], ["A", "B"], ["C", "D"]),
        (["Solo ft. Guest"], ["Solo"], ["Guest"]),
        (["X", "Y", "X"], ["X", "Y"], []),
        (["Земфира featuring Гость"], ["Земфира"], ["Гость"]),
    ],
)
def test_split_artists(raw: list[str], main: list[str], feat: list[str]) -> None:
    assert split_artists(raw) == (main, feat)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Song (feat. X & Y) (Live)", ("Song", "Live", ["X", "Y"])),
        ("Song - Radio Edit", ("Song", "Radio Edit", [])),
        ("Song [Extended Mix]", ("Song", "Extended Mix", [])),
        ("Live and Let Die", ("Live and Let Die", None, [])),
        ("(Remix)", ("(Remix)", None, [])),
    ],
)
def test_split_title(raw: str, expected: tuple[str, str | None, list[str]]) -> None:
    assert split_title(raw) == expected


def test_positions_dates_lrc() -> None:
    assert parse_position("3/12") == (3, 12)
    assert parse_position("7") == (7, None)
    assert parse_position("0/x") == (None, None)
    assert parse_date("2025") == "2025-01-01"
    assert parse_date("2025-05-01T00:00") == "2025-05-01"
    assert parse_date("2025-13-40") == "2025-01-01"
    assert parse_date("unknown") is None
    lines = parse_lrc("[00:04.50]B\n[00:01.00][00:10.1]A\nnot a line\n[01:02.345]C")
    assert [(line.start_ms, line.text) for line in lines] == [
        (1000, "A"),
        (4500, "B"),
        (10100, "A"),
        (62345, "C"),
    ]


def test_slugify() -> None:
    assert slugify("Земфира — Хочешь?") == "zemfira-hochesh"
    assert slugify("Beyoncé") == "beyonce"
    assert slugify("!!!") == "untitled"


def test_ladder_hires_flac() -> None:
    plan = plan_ladder(_probe("flac", 96_000, 24), has_fdk_aac=False)
    assert [r.quality for r in plan] == [
        Quality.HIRES,
        Quality.LOSSLESS,
        Quality.HIGH,
        Quality.NORMAL,
        Quality.LOW,
    ]
    hires, lossless, high, _, low = plan
    assert (hires.sample_rate, hires.bit_depth) == (96_000, 24)
    assert (lossless.sample_rate, lossless.bit_depth, lossless.resample) == (44_100, 16, True)
    assert (high.codec, high.bitrate, high.sample_rate) == ("aac", 256_000, 48_000)
    assert (low.codec, low.bitrate) == ("aac", 96_000)
    assert plan_ladder(_probe("flac", 96_000, 24), has_fdk_aac=True)[-1].codec == "he-aac"


def test_ladder_never_upscales() -> None:
    # 24/44.1: no Hi-Res badge (needs ≥ 48 kHz), lossless is dithered to 16 bit.
    assert (
        next(r.quality for r in plan_ladder(_probe("flac", 44_100, 24), has_fdk_aac=False))
        == Quality.LOSSLESS
    )
    cd = plan_ladder(_probe("flac", 44_100, 16), has_fdk_aac=False)
    assert (cd[0].quality, cd[0].resample, cd[0].sample_rate) == (Quality.LOSSLESS, False, 44_100)
    mp3 = plan_ladder(_probe("mp3", 44_100, None, 320_000), has_fdk_aac=False)
    assert [(r.quality, r.codec, r.copy_source) for r in mp3] == [
        (Quality.HIGH, "mp3", True),
        (Quality.NORMAL, "aac", False),
        (Quality.LOW, "aac", False),
    ]
    low_mp3 = plan_ladder(_probe("mp3", 44_100, None, 128_000), has_fdk_aac=False)
    assert [r.quality for r in low_mp3] == [Quality.HIGH, Quality.LOW]


def test_loudness_math() -> None:
    sample = """
    [Parsed_ebur128_0 @ 0x1] Summary:

      Integrated loudness:
        I:         -18.3 LUFS
        Threshold: -28.4 LUFS

      Loudness range:
        LRA:         6.1 LU
        Threshold: -38.4 LUFS
        LRA low:   -22.0 LUFS
        LRA high:  -15.9 LUFS

      True peak:
        Peak:       -2.5 dBFS
    """
    assert parse_ebur128(sample) == (-18.3, 6.1, -2.5)
    # Wants +4.3 dB but the peak only allows +1.5 dB under a −1 dBTP ceiling.
    assert replay_gain(-18.3, -2.5, target=-14, ceiling=-1) == 1.5
    assert replay_gain(-8.0, -0.1, target=-14, ceiling=-1) == -6.0
    assert replay_gain(-80.0, -math.inf, target=-14, ceiling=-1) == 0.0
    # Same loudness on every track → album gain equals track gain; loudest peak caps it.
    assert album_gain([(-18.0, -6.0, 1000), (-18.0, -6.0, 3000)], target=-14, ceiling=-1) == 4.0
    assert album_gain([(-18.0, -6.0, 1000), (-18.0, -1.5, 1000)], target=-14, ceiling=-1) == 0.5
    assert album_gain([], target=-14, ceiling=-1) == 0.0


def test_waveform_peaks() -> None:
    signal = np.concatenate([np.zeros(800), np.full(800, 0.5), np.full(800, -1.0)]).astype(np.float32)
    values = peaks(signal, count=3)
    assert values == [0, 128, 255]
    assert peaks(np.zeros(10, dtype=np.float32), count=4) == [0, 0, 0, 0]


def test_preview_window_prefers_loud_section() -> None:
    rate, seconds = 100, 200
    signal = np.full(rate * seconds, 0.05, dtype=np.float32)
    signal[rate * 120 : rate * 150] = 0.9  # chorus at 2:00–2:30
    start = best_window_start_ms(signal, rate, seconds * 1000)
    assert 115_000 <= start <= 120_000
    assert best_window_start_ms(signal[: rate * 20], rate, 20_000) == 0


def test_mp3_gapless_header(tmp_path: object) -> None:
    from pathlib import Path  # noqa: PLC0415

    path = Path(str(tmp_path)) / "x.mp3"
    # 12-bit delay 576 (0x240) and padding 1234 (0x4D2) packed into 3 bytes after "LAME" + 21.
    header = b"\x00" * 40 + b"LAME3.100" + b"\x00" * 12 + bytes([0x24, 0x04, 0xD2]) + b"\x00" * 10
    path.write_bytes(header)
    assert mp3_gapless(path) == (576, 1234)
    path.write_bytes(b"\x00" * 100)
    assert mp3_gapless(path) == (0, 0)
