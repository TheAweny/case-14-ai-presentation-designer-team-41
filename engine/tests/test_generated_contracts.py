"""Generated MVP contract validation at the TypeScript/Python boundary."""

import pytest
from engine.contracts import ArtifactManifest, TemplateProfile
from pydantic import ValidationError

SHA256 = "a" * 64


def test_template_profile_accepts_a_reproducible_template_identity() -> None:
    profile = TemplateProfile.model_validate(
        {
            "schemaVersion": "1.0.0",
            "templateId": "template-1",
            "sourceSha256": SHA256,
            "slideSize": {"widthPt": 960, "heightPt": 540},
            "palette": ["#112233"],
            "typography": [],
            "protectedElements": [],
        }
    )

    assert profile.sourceSha256 == SHA256


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
