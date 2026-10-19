"""HTTP adapter for the visuals layer.

The semantic planner does not call this yet. A future orchestration step can post the same
request this module already serves.
"""

from typing import Any

from engine.contracts import VisualBuildRequest, VisualCompareRequest
from engine.visuals import build_visual, capabilities, compare_subjects


def capability_payload() -> dict[str, Any]:
    return capabilities()


def build_payload(request: VisualBuildRequest) -> dict[str, Any]:
    return build_visual(request.model_dump(mode="json", exclude_none=True))


def compare_payload(request: VisualCompareRequest) -> dict[str, Any]:
    body = request.model_dump(mode="json", exclude_none=True)
    return compare_subjects(body["subjects"])
