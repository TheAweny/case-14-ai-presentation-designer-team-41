"""Writes the golden TemplateIR fixtures that both test suites check against.

The generated .pptx fixtures pin what the parser survives. These pin what it *says*, which is a
different promise and the one the rest of the team depends on: the renderer, the audit and the
overlay all read this JSON, and none of them would notice a field quietly changing shape.

Committing the output makes that change visible as a diff instead. Regenerating it is a
deliberate act with a reviewable result, which is the whole point of a golden file.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from engine.parser import parse_template

from lct_tools.fixtures import build_all_fixtures

__all__ = ["GOLDEN_FIXTURES", "build_golden_payloads", "golden_directory", "main"]

#: Fixtures worth freezing. The two unreadable ones are left out on purpose: they raise rather
#: than produce an IR, and the parser tests already pin the exception each of them gives.
GOLDEN_FIXTURES = (
    "groups",
    "rotation",
    "theme-colors",
    "placeholders",
    "chart",
    "table",
    "media",
    "missing-font",
    "odd-aspect",
)


def golden_directory() -> Path:
    """Where the golden files live, beside the contract fixtures that describe them."""
    return Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/golden"


def build_golden_payloads() -> dict[str, dict[str, Any]]:
    """Parse every golden fixture and return its IR, keyed by fixture name.

    The decks are built into a temporary directory each time. Nothing about the path reaches the
    IR — ``sourceName`` is the file name and the hash excludes it — so two machines produce the
    same payloads from the same library versions.
    """
    with TemporaryDirectory(prefix="lct-golden-") as workspace:
        built = build_all_fixtures(Path(workspace))
        return {name: parse_template(built[name]) for name in GOLDEN_FIXTURES}


def main() -> int:
    """Write the golden files, or report which of them are out of date."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit non-zero when a golden file no longer matches the parser",
    )
    arguments = parser.parse_args()

    destination = golden_directory()
    destination.mkdir(parents=True, exist_ok=True)
    payloads = build_golden_payloads()

    stale: list[str] = []
    for name, payload in payloads.items():
        target = destination / f"{name}.json"
        text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        if arguments.check:
            current = target.read_text(encoding="utf-8") if target.exists() else ""
            if current != text:
                stale.append(name)
            continue
        target.write_text(text, encoding="utf-8")

    if arguments.check:
        if stale:
            print(
                "golden fixtures are out of date: "
                + ", ".join(stale)
                + "\nrun: uv run write-golden-ir",
                file=sys.stderr,
            )
            return 1
        print(f"{len(payloads)} golden fixtures match the parser")
        return 0

    print(f"wrote {len(payloads)} golden fixtures to {destination}")
    return 0
