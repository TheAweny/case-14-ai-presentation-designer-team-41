"""Bounded native Figma v15/Kiwi reader, with no model or network dependency.

Wire formats: evanw/kiwi js/{binary,bb,js}.ts and fig-kiwi 0.0.1 archive.ts.
The embedded schema is interpreted, never executed. Opaque vector/image blobs stay
as bytes; consumers can retain these as evidence without inventing geometry.
"""

from __future__ import annotations

import io
import math
import struct
import zipfile
import zlib
from dataclasses import dataclass
from typing import Any


class FigDecodeError(ValueError):
    """The native document is malformed, unsupported, or exceeds resource limits."""


@dataclass
class _Reader:
    data: bytes
    offset: int = 0
    values: int = 0

    def take(self, size: int) -> bytes:
        if size < 0 or self.offset + size > len(self.data):
            raise FigDecodeError("Truncated Kiwi data")
        result = self.data[self.offset : self.offset + size]
        self.offset += size
        return result

    def byte(self) -> int:
        return self.take(1)[0]

    def uint(self, bits: int = 32) -> int:
        value = 0
        for shift in range(0, bits, 7):
            byte = self.byte()
            if bits == 64 and shift == 56:
                return value | (byte << shift)
            value |= (byte & 127) << shift
            if not byte & 128:
                if value >= 1 << bits:
                    break
                return value
        raise FigDecodeError("Invalid Kiwi variable integer")

    def signed(self, bits: int = 32) -> int:
        value = self.uint(bits)
        return (value >> 1) ^ -(value & 1)

    def string(self) -> str:
        end = self.data.find(b"\0", self.offset)
        if end < 0:
            raise FigDecodeError("Truncated Kiwi string")
        raw = self.take(end - self.offset)
        self.take(1)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise FigDecodeError("Invalid UTF-8 in Kiwi string") from exc

    def count(self, maximum: int = 1_000_000) -> int:
        size = self.uint()
        if size > maximum:
            raise FigDecodeError("Kiwi collection exceeds limit")
        return size


@dataclass(frozen=True)
class _Field:
    name: str
    type_id: int
    array: bool
    number: int


@dataclass(frozen=True)
class _Definition:
    name: str
    kind: int
    fields: tuple[_Field, ...]


def _inflate(data: bytes, limit: int) -> bytes:
    try:
        decoder = zlib.decompressobj(-15)
        result = decoder.decompress(data, limit + 1)
        if len(result) > limit or decoder.unconsumed_tail:
            raise FigDecodeError("Figma decompression exceeds limit")
        if not decoder.eof or decoder.unused_data:
            raise FigDecodeError("Invalid compressed Figma chunk")
        return result
    except zlib.error as exc:
        raise FigDecodeError("Invalid compressed Figma chunk") from exc


def _schema(data: bytes) -> tuple[_Definition, ...]:
    reader = _Reader(data)
    definitions = []
    for _ in range(reader.count(20_000)):
        name, kind = reader.string(), reader.byte()
        if kind not in (0, 1, 2):
            raise FigDecodeError("Unsupported Kiwi definition kind")
        fields = []
        for _ in range(reader.count(20_000)):
            field_name, type_id = reader.string(), reader.signed()
            flags, number = reader.byte(), reader.uint()
            fields.append(_Field(field_name, type_id, bool(flags & 1), number))
        if len({field.name for field in fields}) != len(fields):
            raise FigDecodeError("Duplicate Kiwi field name")
        if len({field.number for field in fields}) != len(fields):
            raise FigDecodeError("Duplicate Kiwi field number")
        if kind == 2 and any(field.number == 0 for field in fields):
            raise FigDecodeError("Invalid Kiwi message field zero")
        definitions.append(_Definition(name, kind, tuple(fields)))
    if reader.offset != len(data):
        raise FigDecodeError("Trailing Kiwi schema bytes")
    if len({definition.name for definition in definitions}) != len(definitions):
        raise FigDecodeError("Duplicate Kiwi definition name")
    for definition in definitions:
        for field in definition.fields:
            if definition.kind != 0 and not -8 <= field.type_id < len(definitions):
                raise FigDecodeError("Invalid Kiwi schema type reference")
    return tuple(definitions)


def _value(reader: _Reader, definitions: tuple[_Definition, ...], type_id: int, depth: int) -> Any:
    reader.values += 1
    if depth > 100 or reader.values > 2_000_000:
        raise FigDecodeError("Kiwi message complexity exceeds limit")
    if type_id == -1:
        return bool(reader.byte())
    if type_id == -2:
        return reader.byte()
    if type_id in (-3, -7):
        return reader.signed(32 if type_id == -3 else 64)
    if type_id in (-4, -8):
        return reader.uint(32 if type_id == -4 else 64)
    if type_id == -5:
        first = reader.byte()
        if first == 0:
            return 0.0
        bits = int.from_bytes(bytes([first]) + reader.take(3), "little")
        bits = ((bits << 23) | (bits >> 9)) & 0xFFFFFFFF
        value = struct.unpack("<f", bits.to_bytes(4, "little"))[0]
        if not math.isfinite(value):
            raise FigDecodeError("Non-finite Kiwi float")
        return value
    if type_id == -6:
        return reader.string()
    definition = definitions[type_id]
    if definition.kind == 0:
        number = reader.uint()
        for field in definition.fields:
            if field.number == number:
                return field.name
        raise FigDecodeError(f"Unknown Kiwi enum value {number}")
    result: dict[str, Any] = {}
    by_number = {field.number: field for field in definition.fields}
    fields = iter(definition.fields)
    while True:
        if definition.kind == 2:
            number = reader.uint()
            if number == 0:
                return result
            if number not in by_number:
                raise FigDecodeError(f"Unknown Kiwi message field {number}")
            field = by_number[number]
            if field.name in result:
                raise FigDecodeError("Duplicate Kiwi message field")
        else:
            field = next(fields, None)
            if field is None:
                return result
        if field.array:
            count = reader.count()
            if field.type_id == -2:
                result[field.name] = reader.take(count)
            else:
                result[field.name] = [
                    _value(reader, definitions, field.type_id, depth + 1) for _ in range(count)
                ]
        else:
            result[field.name] = _value(reader, definitions, field.type_id, depth + 1)


def decode_fig(data: bytes, *, max_uncompressed_bytes: int = 64 * 1024 * 1024) -> dict[str, Any]:
    """Decode native v15 fig-kiwi or ZIP canvas.fig into its schema-defined Message.

    Unsupported versions fail explicitly. This is the native Figma change-message
    representation, not REST API JSON: nodes are generally in ``nodeChanges``.
    """
    if max_uncompressed_bytes < 1 or len(data) > max_uncompressed_bytes:
        raise FigDecodeError("Figma input exceeds limit")
    if data.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                members = [info for info in archive.infolist() if info.filename == "canvas.fig"]
                if len(members) != 1:
                    raise FigDecodeError("Figma ZIP requires exactly one canvas.fig")
                member = members[0]
                if member.file_size > max_uncompressed_bytes:
                    raise FigDecodeError("Figma canvas exceeds limit")
                with archive.open(member) as stream:
                    data = stream.read(max_uncompressed_bytes + 1)
                if len(data) > max_uncompressed_bytes:
                    raise FigDecodeError("Figma canvas exceeds limit")
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError) as exc:
            raise FigDecodeError("Invalid Figma ZIP") from exc
    if len(data) < 12 or data[:8] != b"fig-kiwi":
        raise FigDecodeError("Invalid native Figma header")
    version = struct.unpack_from("<I", data, 8)[0]
    if version != 15:
        raise FigDecodeError(f"Unsupported Figma container version {version}")
    reader = _Reader(data, offset=12)
    chunks = []
    while reader.offset < len(data):
        if len(chunks) >= 16 or len(data) - reader.offset < 4:
            raise FigDecodeError("Invalid Figma chunk table")
        size = struct.unpack("<I", reader.take(4))[0]
        if size > len(data) - reader.offset:
            raise FigDecodeError("Truncated Figma chunk")
        chunks.append(reader.take(size))
    if len(chunks) < 2:
        raise FigDecodeError("Figma requires schema and message chunks")
    schema_bytes = _inflate(chunks[0], max_uncompressed_bytes)
    definitions = _schema(schema_bytes)
    message_bytes = _inflate(chunks[1], max_uncompressed_bytes - len(schema_bytes))
    message_reader = _Reader(message_bytes)
    message_type = next((i for i, item in enumerate(definitions) if item.name == "Message"), None)
    if message_type is None or definitions[message_type].kind != 2:
        raise FigDecodeError("Figma schema has no Message definition")
    result = _value(message_reader, definitions, message_type, 0)
    if message_reader.offset != len(message_bytes):
        raise FigDecodeError("Trailing Kiwi message bytes")
    return result
