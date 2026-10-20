"""Bounded archive readers never materialize member-controlled filesystem paths."""

from __future__ import annotations

import ctypes
import ctypes.util
import io
import stat
import zipfile
from pathlib import PurePosixPath

MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_ENTRIES = 4096
MAX_DEPTH = 5


class ArchiveError(ValueError):
    """Unsafe, encrypted or unreadable package."""


def safe_name(name: str) -> str:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        path.is_absolute()
        or ".." in path.parts
        or ":" in normalized
        or "\x00" in normalized
        or not path.parts
    ):
        raise ArchiveError(f"Unsafe archive path: {name!r}")
    return str(path)


def zip_members(data: bytes):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > MAX_ENTRIES:
            raise ArchiveError("Archive entry count exceeded")
        names = set()
        for entry in archive.infolist():
            name = safe_name(entry.filename)
            if name in names:
                raise ArchiveError(f"Duplicate archive member: {name}")
            names.add(name)
            if entry.flag_bits & 1:
                raise ArchiveError("Encrypted archives are unsupported")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ArchiveError("Archive links are forbidden")
            if entry.is_dir():
                continue
            if entry.file_size > MAX_FILE or entry.file_size > max(
                1024 * 1024, entry.compress_size * 500
            ):
                raise ArchiveError("Archive expansion limit exceeded")
            with archive.open(entry) as stream:
                payload = stream.read(MAX_FILE + 1)
            if len(payload) > MAX_FILE:
                raise ArchiveError("Archive member limit exceeded")
            yield name, payload


def rar_members(data: bytes):
    library = ctypes.util.find_library("archive")
    if not library:
        raise ArchiveError("RAR support requires the system libarchive library")
    lib = ctypes.CDLL(library)
    signatures = {
        "archive_read_new": (ctypes.c_void_p, []),
        "archive_read_support_filter_all": (ctypes.c_int, [ctypes.c_void_p]),
        "archive_read_support_format_all": (ctypes.c_int, [ctypes.c_void_p]),
        "archive_read_open_memory": (
            ctypes.c_int,
            [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t],
        ),
        "archive_read_next_header": (
            ctypes.c_int,
            [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)],
        ),
        "archive_entry_pathname": (ctypes.c_char_p, [ctypes.c_void_p]),
        "archive_entry_size": (ctypes.c_longlong, [ctypes.c_void_p]),
        "archive_entry_filetype": (ctypes.c_uint, [ctypes.c_void_p]),
        "archive_entry_symlink": (ctypes.c_char_p, [ctypes.c_void_p]),
        "archive_entry_hardlink": (ctypes.c_char_p, [ctypes.c_void_p]),
        "archive_entry_is_encrypted": (ctypes.c_int, [ctypes.c_void_p]),
        "archive_read_data": (
            ctypes.c_ssize_t,
            [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t],
        ),
        "archive_error_string": (ctypes.c_char_p, [ctypes.c_void_p]),
        "archive_read_free": (ctypes.c_int, [ctypes.c_void_p]),
    }
    for name, (restype, argtypes) in signatures.items():
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = restype, argtypes
    reader = lib.archive_read_new()
    backing = ctypes.create_string_buffer(data)
    try:
        lib.archive_read_support_filter_all(reader)
        lib.archive_read_support_format_all(reader)
        if lib.archive_read_open_memory(reader, backing, len(data)) != 0:
            raise ArchiveError("Cannot open RAR package")
        count = 0
        names = set()
        while True:
            entry = ctypes.c_void_p()
            code = lib.archive_read_next_header(reader, ctypes.byref(entry))
            if code == 1:
                break
            if code < 0:
                raise ArchiveError(
                    (lib.archive_error_string(reader) or b"Invalid RAR").decode(errors="replace")
                )
            count += 1
            if count > MAX_ENTRIES:
                raise ArchiveError("Archive entry count exceeded")
            name = safe_name(lib.archive_entry_pathname(entry).decode("utf-8", errors="replace"))
            if name in names:
                raise ArchiveError(f"Duplicate archive member: {name}")
            names.add(name)
            if lib.archive_entry_symlink(entry) or lib.archive_entry_hardlink(entry):
                raise ArchiveError("Archive links are forbidden")
            if lib.archive_entry_is_encrypted(entry) > 0:
                raise ArchiveError("Encrypted archives are unsupported")
            if lib.archive_entry_filetype(entry) == stat.S_IFDIR:
                continue
            if lib.archive_entry_filetype(entry) not in (0, stat.S_IFREG):
                raise ArchiveError("Special archive files are forbidden")
            if lib.archive_entry_size(entry) > MAX_FILE:
                raise ArchiveError("Archive member limit exceeded")
            chunks, total = [], 0
            buffer = ctypes.create_string_buffer(65536)
            while True:
                size = lib.archive_read_data(reader, buffer, len(buffer))
                if size < 0:
                    raise ArchiveError("RAR member decompression failed")
                if not size:
                    break
                total += size
                if total > MAX_FILE:
                    raise ArchiveError("Archive member limit exceeded")
                chunks.append(buffer.raw[:size])
            yield name, b"".join(chunks)
    finally:
        lib.archive_read_free(reader)
