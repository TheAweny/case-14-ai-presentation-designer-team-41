"""Generated contract validation at the TypeScript/Python boundary."""

import json
from pathlib import Path

import pytest
from engine.contracts import ArtifactManifest, DesignSystem
from pydantic import ValidationError

SHA256 = "a" * 64


def test_design_system_accepts_the_shared_fixture() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[2] / "packages/contracts/fixtures/DesignSystem.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    design_system = DesignSystem.model_validate(fixture["valid"][0]["payload"])

    assert design_system.templateHash == "0" * 64


def test_artifact_manifest_rejects_a_missing_variant() -> None:
    with pytest.raises(ValidationError):
        ArtifactManifest.model_validate(
            {
                "schemaVersion": "1.0.0",
                "runId": "run-1",
                "inputHashes": {"template": SHA256, "content": SHA256},
                "gitSha": "b" * 40,
                "seed": 1,
                "variants": [],
            }
        )
