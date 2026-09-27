"""`deck-audit`: the audit endpoint as a command, for checking generator output offline.

Reads an AuditRequest as JSON from a file or standard input and writes the AuditReport to
standard output. The exit status is 0 when the deck passes, 1 when a finding holds it back and
2 when the request itself is not valid.
"""

import argparse
import json
import sys

from fastapi import HTTPException
from pydantic import ValidationError

from engine.api.app import audit
from engine.contracts import AuditRequest

__all__ = ["main"]


def main(argv: list[str] | None = None) -> int:
    """Audit one deck and print the report."""
    parser = argparse.ArgumentParser(prog="deck-audit", description=__doc__)
    parser.add_argument("request", nargs="?", default="-", help="AuditRequest JSON, - for stdin")
    parser.add_argument("--profile", help="Audit profile, overriding the one in the request")
    args = parser.parse_args(argv)
    if args.request == "-":
        raw = sys.stdin.read()
    else:
        with open(args.request, encoding="utf-8") as source:
            raw = source.read()
    try:
        payload = json.loads(raw)
        if args.profile:
            payload["profile"] = args.profile
        request = AuditRequest.model_validate(payload)
    except (json.JSONDecodeError, ValidationError) as error:
        print(f"deck-audit: invalid request: {error}", file=sys.stderr)
        return 2
    try:
        report = audit(request)
    except HTTPException as error:
        print(f"deck-audit: {error.detail}", file=sys.stderr)
        return 2
    print(report.model_dump_json(indent=2))
    return 0 if report.passed else 1
