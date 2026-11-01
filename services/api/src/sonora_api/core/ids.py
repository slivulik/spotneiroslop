import os
import time
import uuid


def uuid7() -> uuid.UUID:
    """RFC 9562 UUIDv7: 48-bit Unix ms timestamp + 74 random bits.

    Time-ordered keys keep B-tree inserts append-only (less index bloat than v4) and
    make ids roughly sortable by creation time.
    """
    ts_ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    rand_a = rand >> 62 & 0xFFF  # 12 bits
    rand_b = rand & ((1 << 62) - 1)  # 62 bits
    value = (ts_ms & ((1 << 48) - 1)) << 80 | 0x7 << 76 | rand_a << 64 | 0b10 << 62 | rand_b
    return uuid.UUID(int=value)
