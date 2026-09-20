"""Typed failures of the parser.

A malformed upload must come back as a named error with a readable message, never as a traceback:
the acceptance criteria say so, and a user who uploaded the wrong file deserves a sentence rather
than a stack.
"""

from __future__ import annotations


class TemplateParseError(Exception):
    """The file cannot be read as a PowerPoint template."""

    def __init__(self, message: str, *, source_name: str = "") -> None:
        self.source_name = source_name
        super().__init__(message)


class NotAPackageError(TemplateParseError):
    """The file is not a readable OOXML package."""


class NotAPresentationError(TemplateParseError):
    """The package is readable but holds no presentation."""


class MalformedPresentationError(TemplateParseError):
    """The presentation part exists but cannot be interpreted."""
