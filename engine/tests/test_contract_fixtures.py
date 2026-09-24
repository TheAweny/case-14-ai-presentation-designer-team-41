"""The shared fixtures mean the same thing to Pydantic as they do to Zod.

``packages/contracts/fixtures`` is written once and read by both suites. That is the point: a
contract only holds if the two sides agree about it, and the cheapest way to find out that they
do not is to hand them the same JSON and watch one of them disagree.

The golden files go further. They are real parser output, so they catch the other direction as
well: a change in what the engine emits shows up as a diff, and a change in the contract that no
longer accepts that output shows up as a failure here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import engine.contracts as contracts
import pytest
from lct_tools.golden import GOLDEN_FIXTURES, build_golden_payloads, golden_directory
from pydantic import BaseModel, ValidationError

_FIXTURE_DIR = Path(__file__).resolve().parents[2] / "packages/contracts/fixtures"

#: Contracts whose fixtures both sides check. The list is derived from the files on disk so a new
#: contract is covered the moment its fixture lands, rather than when somebody remembers this
#: module exists.
_CONTRACTS = sorted(path.stem for path in _FIXTURE_DIR.glob("*.json"))


def _fixture(contract: str) -> dict[str, Any]:
    return json.loads((_FIXTURE_DIR / f"{contract}.json").read_text(encoding="utf-8"))


def _model(contract: str) -> type[BaseModel]:
    model = getattr(contracts, contract, None)
    assert model is not None, f"{contract} has a fixture but no generated model"
    assert isinstance(model, type) and issubclass(model, BaseModel)
    return model


def test_there_are_fixtures_to_check() -> None:
    """A glob that silently matches nothing would make every test below vacuously pass."""
    assert len(_CONTRACTS) >= 10, _CONTRACTS


@pytest.mark.parametrize("contract", _CONTRACTS)
def test_every_contract_has_a_generated_model(contract: str) -> None:
    assert _model(contract).__name__ == contract


@pytest.mark.parametrize("contract", _CONTRACTS)
def test_valid_fixtures_are_accepted(contract: str) -> None:
    model = _model(contract)
    cases = _fixture(contract)["valid"]
    assert cases, f"{contract} has no valid case"
    for case in cases:
        model.model_validate(case["payload"])


@pytest.mark.parametrize("contract", _CONTRACTS)
def test_invalid_fixtures_are_refused(contract: str) -> None:
    """Refused by Pydantic too, not only by Zod.

    The two sides do not have to fail at the same place — a union reports differently in each —
    but they do have to fail.
    """
    model = _model(contract)
    cases = _fixture(contract)["invalid"]
    assert cases, f"{contract} has no invalid case"
    for case in cases:
        with pytest.raises(ValidationError):
            model.model_validate(case["payload"])


@pytest.mark.parametrize("name", GOLDEN_FIXTURES)
def test_golden_files_match_the_contract(name: str) -> None:
    payload = json.loads((golden_directory() / f"{name}.json").read_text(encoding="utf-8"))
    contracts.TemplateIR.model_validate(payload)


def test_golden_files_match_what_the_parser_emits_today() -> None:
    """The check that makes the golden files worth committing.

    A failure here is not necessarily a bug: it means the parser output changed. Look at the
    diff, decide whether the change was intended, and run ``uv run write-golden-ir``.
    """
    expected = build_golden_payloads()
    directory = golden_directory()

    stale: list[str] = []
    for name, payload in expected.items():
        committed = json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))
        if committed != payload:
            stale.append(name)

    assert not stale, (
        f"golden fixtures no longer match the parser: {', '.join(stale)}. "
        "Review the diff, then run: uv run write-golden-ir"
    )


def test_golden_files_cover_the_parser_branches_worth_freezing() -> None:
    """Nine files that all say the same thing would be nine files not worth reading."""
    payloads = {
        name: json.loads((golden_directory() / f"{name}.json").read_text(encoding="utf-8"))
        for name in GOLDEN_FIXTURES
    }

    def shapes(payload: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            shape
            for group in ("masters", "layouts", "slides")
            for part in payload[group]
            for shape in part["shapes"]
        ]

    assert any(shape["path"] for shape in shapes(payloads["groups"]))
    assert any(shape["rotation"] for shape in shapes(payloads["rotation"]))
    assert any(shape["chartPart"] for shape in shapes(payloads["chart"]))
    assert any(shape["tableSize"] for shape in shapes(payloads["table"]))
    assert any(shape["placeholder"] for shape in shapes(payloads["placeholders"]))
    assert payloads["media"]["media"]
    assert payloads["odd-aspect"]["aspect"] != payloads["groups"]["aspect"]
    assert payloads["theme-colors"]["themeColors"]
