"""BlurHash encoder (https://blurha.sh), vectorised with numpy."""

from __future__ import annotations

import numpy as np
from PIL import Image

_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"


def _b83(value: int, length: int) -> str:
    return "".join(_CHARS[(value // 83 ** (length - i - 1)) % 83] for i in range(length))


def _to_linear(v: np.ndarray) -> np.ndarray:
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def _to_srgb(v: float) -> int:
    v = min(max(v, 0.0), 1.0)
    return round((v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055) * 255)


def _sign_pow(v: float, exp: float) -> float:
    return float(np.sign(v) * abs(v) ** exp)


def encode(image: Image.Image, x_components: int = 4, y_components: int = 3) -> str:
    small = np.asarray(image.convert("RGB").resize((32, 32), Image.Resampling.BILINEAR), dtype=np.float64)
    linear = _to_linear(small)
    h, w = linear.shape[:2]
    xs, ys = np.arange(w), np.arange(h)
    factors = []
    for j in range(y_components):
        for i in range(x_components):
            basis = np.outer(np.cos(np.pi * j * ys / h), np.cos(np.pi * i * xs / w))
            norm = 1 if i == j == 0 else 2
            factors.append(norm * (linear * basis[:, :, None]).sum(axis=(0, 1)) / (w * h))
    dc, ac = factors[0], factors[1:]

    out = _b83((x_components - 1) + (y_components - 1) * 9, 1)
    if ac:
        actual_max = max(float(np.abs(f).max()) for f in ac)
        quant_max = max(0, min(82, int(actual_max * 166 - 0.5)))
        max_value = (quant_max + 1) / 166
        out += _b83(quant_max, 1)
    else:
        max_value = 1.0
        out += _b83(0, 1)
    out += _b83((_to_srgb(dc[0]) << 16) + (_to_srgb(dc[1]) << 8) + _to_srgb(dc[2]), 4)
    for f in ac:
        q = [max(0, min(18, int(np.floor(_sign_pow(c / max_value, 0.5) * 9 + 9.5)))) for c in f]
        out += _b83(q[0] * 19 * 19 + q[1] * 19 + q[2], 2)
    return out
