"""The parser output matches the shared TemplateIR contract.

The contract lives in ``packages/contracts/src/template-ir.ts`` and reaches Python as a generated
Pydantic model. Generating it needs Node, which CI has and a Python-only checkout may not, so
these tests pin the same thing structurally: the field names, their nesting and their types.

That is enough to catch the failure that actually happens, which is someone adding a field on one
side and forgetting the other. When the generated model is present, ``test_generated_model_accepts_
the_parser_output`` validates against it for real.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from engine.parser import TEMPLATE_IR_SCHEMA_VERSION, parse_template, parse_template_ir
from lct_tools.fixtures import build_all_fixtures

#: Top level of the contract, exactly as template-ir.ts declares it.
_TEMPLATE_IR_KEYS = {
    "schemaVersion",
    "sourceName",
    "slideCx",
    "slideCy",
    "aspect",
    "hash",
    "themeColors",
    "themeFonts",
    "masters",
    "layouts",
    "slides",
    "media",
    "warnings",
}

_SHAPE_KEYS = {
    "shapeId",
    "name",
    "kind",
    "box",
    "rotation",
    "flipH",
    "flipV",
    "z",
    "path",
    "placeholder",
    "paragraphs",
    "mediaPart",
    "tableSize",
    "chartPart",
    "chartType",
}

_SLIDE_LIKE_KEYS = {"part", "name", "follows", "shapes"}
_BOX_KEYS = {"x", "y", "cx", "cy"}
_RUN_KEYS = {"text", "font", "sizePt", "bold", "italic", "color"}
_MEDIA_KEYS = {"part", "contentType", "bytes", "widthPx", "heightPx"}
_WARNING_KEYS = {"code", "message", "location"}


@pytest.fixture(scope="module")
def profile(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    """One parsed profile, rich enough to exercise every branch of the contract."""
    built = build_all_fixtures(tmp_path_factory.mktemp("contract"))
    return parse_template(built["chart"])


@pytest.fixture(scope="module")
def rich_profile(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    """A profile that carries media, a table and text, for the branches ``chart`` misses."""
    built = build_all_fixtures(tmp_path_factory.mktemp("contract-rich"))
    unreadable = {"not-a-package", "malformed-xml"}
    return {name: parse_template(path) for name, path in built.items() if name not in unreadable}


def _all_shapes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        shape
        for group in ("masters", "layouts", "slides")
        for container in payload[group]
        for shape in container["shapes"]
    ]


def test_top_level_matches_the_contract(profile: dict[str, Any]) -> None:
    assert set(profile) == _TEMPLATE_IR_KEYS


def test_schema_version_is_declared_and_agrees_with_the_module(profile: dict[str, Any]) -> None:
    """A version that drifts from the code is worse than no version at all."""
    assert profile["schemaVersion"] == TEMPLATE_IR_SCHEMA_VERSION
    assert isinstance(profile["schemaVersion"], int)


def test_every_key_is_camel_case(profile: dict[str, Any]) -> None:
    """The contract is generated from Zod, so camel case is the house style on this boundary."""

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                assert "_" not in key, f"{key} is not camel case"
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(profile)


def test_shape_fields_match_the_contract(profile: dict[str, Any]) -> None:
    shapes = _all_shapes(profile)
    assert shapes, "the fixture must carry shapes for this to mean anything"
    for shape in shapes:
        assert set(shape) == _SHAPE_KEYS


def test_slide_like_fields_match_the_contract(profile: dict[str, Any]) -> None:
    for group in ("masters", "layouts", "slides"):
        for container in profile[group]:
            assert set(container) == _SLIDE_LIKE_KEYS


def test_geometry_is_integer_emu_or_absent(profile: dict[str, Any]) -> None:
    """EMU is an integer unit. A float here means something divided somewhere it should not."""
    for shape in _all_shapes(profile):
        box = shape["box"]
        if box is None:
            continue
        assert set(box) == _BOX_KEYS
        assert all(isinstance(value, int) for value in box.values())


def test_text_runs_match_the_contract(rich_profile: dict[str, Any]) -> None:
    runs = [
        run
        for shape in _all_shapes(rich_profile["missing-font"])
        for paragraph in shape["paragraphs"]
        for run in paragraph["runs"]
    ]
    assert runs, "the missing-font fixture carries text"
    for run in runs:
        assert set(run) == _RUN_KEYS


def test_media_entries_match_the_contract(rich_profile: dict[str, Any]) -> None:
    media = rich_profile["media"]["media"]
    assert media, "the media fixture carries one image"
    for item in media:
        assert set(item) == _MEDIA_KEYS


def test_warnings_match_the_contract(rich_profile: dict[str, Any]) -> None:
    """Warnings are part of the contract even when a healthy template produces none."""
    for payload in rich_profile.values():
        for warning in payload["warnings"]:
            assert set(warning) == _WARNING_KEYS
            assert isinstance(warning["code"], str)


def test_optional_fields_are_null_rather_than_missing(rich_profile: dict[str, Any]) -> None:
    """A consumer reads a fixed shape. An absent key and a null one are not the same thing."""
    for shape in _all_shapes(rich_profile["groups"]):
        assert "placeholder" in shape
        assert "tableSize" in shape
        assert "box" in shape


def test_the_profile_survives_a_json_round_trip(profile: dict[str, Any]) -> None:
    """The boundary is JSON. Anything that cannot cross it does not belong in the contract."""
    assert json.loads(json.dumps(profile)) == profile


def test_hash_is_a_sha256_digest(profile: dict[str, Any]) -> None:
    digest = profile["hash"]
    assert len(digest) == 64
    assert all(character in "0123456789abcdef" for character in digest)


def test_generated_model_accepts_the_parser_output(profile: dict[str, Any]) -> None:
    """The real check, once ``yarn codegen`` has produced the model from the Zod schema."""
    generated = pytest.importorskip(
        "engine.contracts._generated", reason="run yarn codegen to generate the contract models"
    )
    model = getattr(generated, "TemplateIR", None)
    if model is None:
        pytest.skip("TemplateIR is not in the generated module yet")
    model.model_validate(profile)


def test_the_zod_schema_declares_the_same_top_level_fields() -> None:
    """Read the Zod source directly, so a drift is caught without Node being installed."""
    source = Path(__file__).resolve().parents[2] / "packages/contracts/src/template-ir.ts"
    text = source.read_text(encoding="utf-8")
    start = text.index("export const templateIrSchema")
    body = text[start : text.index("});", start)]
    declared = {
        line.split(":", 1)[0].strip()
        for line in body.splitlines()
        if ":" in line and line.startswith("  ") and not line.strip().startswith(("*", "//"))
    }
    assert declared >= _TEMPLATE_IR_KEYS, _TEMPLATE_IR_KEYS - declared


def test_parsing_twice_gives_the_same_contract_payload(tmp_path: Path) -> None:
    built = build_all_fixtures(tmp_path)
    first = parse_template_ir(built["table"]).to_dict()
    second = parse_template_ir(built["table"]).to_dict()
    assert first == second
