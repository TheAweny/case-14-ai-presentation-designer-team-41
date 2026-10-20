"""Native Kiwi fixtures exercise binary schema and message decoding."""

import io
import struct
import zipfile
import zlib

import pytest
from engine.parser.brandbook_fig import FigDecodeError, decode_fig


def uint(value: int) -> bytes:
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    return bytes(result + bytes([value]))


def string(value: str) -> bytes:
    return value.encode() + b"\0"


def native_fig(*, message: bytes | None = None, version: int = 15) -> bytes:
    # Message { Node[] nodeChanges = 1; } and Node fields use native Kiwi IDs.
    definitions = [
        ("Message", 2, [("nodeChanges", 1, True, 1)]),
        ("Node", 2, [("name", -6, False, 1), ("opacity", -5, False, 2)]),
    ]
    schema = bytearray(uint(len(definitions)))
    for name, kind, fields in definitions:
        schema.extend(string(name) + bytes([kind]) + uint(len(fields)))
        for field, type_id, array, number in fields:
            zigzag = type_id * 2 if type_id >= 0 else -type_id * 2 - 1
            schema.extend(string(field) + uint(zigzag) + bytes([array]) + uint(number))
    if message is None:
        # IEEE float 1.0 with Kiwi's rotated exponent encoding.
        bits = 0x3F800000
        kiwi_float = ((bits >> 23) | (bits << 9)) & 0xFFFFFFFF
        message = b"\1\1\1" + string("Бренд / Основной")
        message += b"\2" + struct.pack("<I", kiwi_float) + b"\0\0"
    chunks = []
    for content in (bytes(schema), message):
        compressor = zlib.compressobj(wbits=-15)
        compressed = compressor.compress(content) + compressor.flush()
        chunks.append(struct.pack("<I", len(compressed)) + compressed)
    return b"fig-kiwi" + struct.pack("<I", version) + b"".join(chunks)


def test_decodes_native_binary_schema_and_unicode_message():
    assert decode_fig(native_fig()) == {
        "nodeChanges": [{"name": "Бренд / Основной", "opacity": 1.0}]
    }


def test_decodes_zip_canvas_without_extracting():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("canvas.fig", native_fig())
        archive.writestr("meta.json", '{"name":"Demo"}')
    assert decode_fig(buffer.getvalue()) == decode_fig(native_fig())


def test_rejects_json_renamed_fig():
    with pytest.raises(FigDecodeError, match="header"):
        decode_fig(b'{"document": {}}')


def test_rejects_unknown_container_version():
    with pytest.raises(FigDecodeError, match="version 99"):
        decode_fig(native_fig(version=99))


def test_rejects_truncated_chunk():
    with pytest.raises(FigDecodeError, match="chunk"):
        decode_fig(native_fig()[:-1])


def test_rejects_unknown_message_field():
    with pytest.raises(FigDecodeError, match="field 99"):
        decode_fig(native_fig(message=b"\x63\0"))


def test_limits_decompressed_schema_and_message():
    with pytest.raises(FigDecodeError, match="limit"):
        decode_fig(native_fig(), max_uncompressed_bytes=20)


def test_rejects_unterminated_message():
    with pytest.raises(FigDecodeError, match="Truncated"):
        decode_fig(native_fig(message=b"\1\1\1" + string("Brand")))


def test_rejects_trailing_message_bytes():
    with pytest.raises(FigDecodeError, match="Trailing"):
        decode_fig(native_fig(message=b"\0\1"))


def test_requires_unambiguous_canvas_zip_member():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("other.fig", native_fig())
    with pytest.raises(FigDecodeError, match=r"canvas\.fig"):
        decode_fig(buffer.getvalue())


def test_decodes_native_kiwi_uint64_nine_byte_encoding():
    from engine.parser.brandbook_fig import _Reader

    assert _Reader(b"\xff" * 9).uint(64) == 2**64 - 1
    assert _Reader(b"\xff" * 9).signed(64) == -(2**63)


def test_decodes_struct_enum_byte_array_and_zero_float():
    from engine.parser.brandbook_fig import _Reader, _schema, _value

    # Message { Details details = 1; }, Details { Kind kind; byte[] data; float x; }
    # Kind is an enum with a sparse numeric value, proving schema-based lookup.
    schema = uint(3)
    schema += string("Message") + b"\2\1" + string("details") + b"\2\0\1"
    schema += string("Details") + b"\1\3"
    schema += string("kind") + b"\4\0\1"
    schema += string("data") + b"\3\1\2"
    schema += string("x") + b"\x09\0\3"
    schema += string("Kind") + b"\0\1" + string("FRAME") + b"\0\0\x07"
    reader = _Reader(b"\1\x07\3abc\0\0")
    assert _value(reader, _schema(schema), 0, 0) == {
        "details": {"kind": "FRAME", "data": b"abc", "x": 0.0}
    }


def test_rejects_overlong_uint32():
    from engine.parser.brandbook_fig import _Reader

    with pytest.raises(FigDecodeError, match="integer"):
        _Reader(b"\xff" * 6).uint()
