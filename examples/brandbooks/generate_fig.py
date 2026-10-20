"""Create the CC0 native Figma Kiwi demonstration fixture."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).parent


def uint(value: int) -> bytes:
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    return bytes(out) + bytes([value])


def string(value: str) -> bytes:
    return value.encode() + b"\0"


def native_fig() -> bytes:
    defs = [
        ("Message", 2, [("nodeChanges", 1, True, 1)]),
        ("Node", 2, [("name", -6, False, 1), ("opacity", -5, False, 2)]),
    ]
    schema = bytearray(uint(len(defs)))
    for name, kind, fields in defs:
        schema.extend(string(name) + bytes([kind]) + uint(len(fields)))
        for field, type_id, array, number in fields:
            zigzag = type_id * 2 if type_id >= 0 else -type_id * 2 - 1
            schema.extend(string(field) + uint(zigzag) + bytes([array]) + uint(number))
    bits = 0x3F800000
    kiwi = ((bits >> 23) | (bits << 9)) & 0xFFFFFFFF
    message = b"\1\1\1" + string("Northstar / Primary") + b"\2" + struct.pack("<I", kiwi) + b"\0\0"
    chunks = []
    for content in (bytes(schema), message):
        c = zlib.compressobj(wbits=-15)
        chunks.append(struct.pack("<I", len(c.compress(content) + c.flush())) + (lambda x: x)(b""))
    # Rebuild explicitly to keep chunk lengths and bytes paired.
    chunks = []
    for content in (bytes(schema), message):
        c = zlib.compressobj(wbits=-15)
        compressed = c.compress(content) + c.flush()
        chunks.append(struct.pack("<I", len(compressed)) + compressed)
    return b"fig-kiwi" + struct.pack("<I", 15) + b"".join(chunks)


(ROOT / "northstar.fig").write_bytes(native_fig())
