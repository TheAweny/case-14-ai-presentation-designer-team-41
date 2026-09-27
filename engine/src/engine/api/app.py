"""FastAPI application of the engine."""

import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from PIL import Image, UnidentifiedImageError

from engine import __version__, checks, export, layout, parser
from engine.api._profiles import UnknownProfileError, deterministic_profile
from engine.contracts import (
    AuditReport,
    AuditRequest,
    DeckPlan,
    EditableDeckRequest,
    EditableDeckResponse,
    HealthCheck,
    LayoutVariantsRequest,
    LayoutVariantsResponse,
    Status,
)

_STARTED_AT = time.monotonic()

app = FastAPI(
    title="Deck engine",
    version=__version__,
    description=(
        "Deterministic document engine: template parsing, layout, visuals, export, render and "
        "the deterministic audit checks. It never calls a model."
    ),
)


@app.get("/health", response_model=HealthCheck, summary="Liveness of the engine")
def health() -> HealthCheck:
    """Report that the engine process is up, using the shared health contract."""
    return HealthCheck(
        status=Status.ok,
        service="engine",
        version=__version__,
        uptimeSeconds=time.monotonic() - _STARTED_AT,
    )


@app.post(
    "/v1/editable-decks",
    response_model=EditableDeckResponse,
    summary="Build one editable PPTX from a local template and fixture content",
)
def build_editable_deck(request: EditableDeckRequest) -> EditableDeckResponse:
    """Join deterministic parser, layout and export layers for the MVP vertical slice."""
    template_path = Path(request.templatePath).resolve()
    if not template_path.is_file():
        raise HTTPException(status_code=404, detail="Template PPTX was not found.")

    design_system, patterns = parser.template_profile_of(template_path)
    plan = DeckPlan.model_validate(
        {
            "schemaVersion": 1,
            "planId": f"plan-{request.runId}",
            "briefId": request.runId,
            "title": request.slides[0].title,
            "language": "ru",
            "slides": [
                {
                    "slideId": slide.slideId,
                    "headline": slide.title,
                    "subhead": "",
                    "intent": "statement",
                    "blocks": [{"kind": "paragraph", "text": slide.body}],
                    "speakerNotes": "",
                    "sources": [],
                }
                for index, slide in enumerate(request.slides, start=1)
            ],
        }
    )
    output_path = Path(request.outputPath).resolve()
    slide_ir = layout.build_slide_ir(plan, design_system, patterns)
    export.export_pptx(slide_ir, design_system, template_path, output_path)
    return EditableDeckResponse.model_validate(
        {
            "schemaVersion": 1,
            "outputPath": str(output_path),
            "designSystem": design_system,
            "slideCount": len(slide_ir),
        }
    )


def _media_sizes(slides: list[dict[str, Any]], stated: dict[str, Any]) -> dict[str, Any]:
    """Pixel sizes of the pictures: those the caller stated, then files the engine can open."""
    sizes = dict(stated)
    for slide in slides:
        for element in slide["elements"]:
            part = element.get("mediaPart")
            if element["kind"] != "image" or not part or part in sizes:
                continue
            path = Path(part)
            if not path.is_file():
                continue
            try:
                with Image.open(path) as picture:
                    sizes[part] = {"width": picture.width, "height": picture.height}
            except (OSError, UnidentifiedImageError):
                continue
    return sizes


@app.post(
    "/v1/audit",
    response_model=AuditReport,
    summary="Verify generated slides against the template and the audit profile",
)
def audit(request: AuditRequest) -> AuditReport:
    """Measure every slide of a generated deck and report what breaks the requirements.

    The input is whatever a generator produced, as SlideIR, with the design system of the template
    it was asked to follow. Nothing in it is trusted: layout, template fidelity and density are
    measured here, and each finding says what is wrong, why, and how to fix it when that can be
    computed.
    """
    payload = request.model_dump(mode="json", exclude_unset=True)
    profile_name = request.profile or "default"
    try:
        profile = deterministic_profile(profile_name)
    except UnknownProfileError as error:
        raise HTTPException(status_code=422, detail=f"Unknown audit profile {error}.") from error
    payload["mediaSizes"] = _media_sizes(payload["slides"], payload.get("mediaSizes") or {})
    return AuditReport.model_validate(checks.audit_deck(payload, profile_name, profile))


@app.post(
    "/v1/layouts",
    response_model=LayoutVariantsResponse,
    summary="Lay one deck plan out as the three variants on a local template",
)
def build_layouts(request: LayoutVariantsRequest) -> LayoutVariantsResponse:
    """Build the requested variants of one plan against the profile of one template.

    The plan is reused as it is: every variant carries the same words, and the variants differ
    in the layouts they take from the template and in how copy sits in them.
    """
    template_path = Path(request.templatePath).resolve()
    if not template_path.is_file():
        raise HTTPException(status_code=404, detail="Template PPTX was not found.")
    design_system, patterns = parser.template_profile_of(template_path)
    plan = DeckPlan.model_validate(request.plan.model_dump(mode="json"))
    wanted = [str(getattr(v, "value", v)) for v in request.variants or layout.VARIANTS]
    variants = [
        {
            "variant": variant,
            "slides": [
                slide.model_dump(mode="json", exclude_unset=True)
                for slide in layout.build_slide_ir(plan, design_system, patterns, variant)
            ],
        }
        for variant in layout.VARIANTS
        if variant in wanted
    ]
    return LayoutVariantsResponse.model_validate(
        {
            "schemaVersion": 1,
            "designSystem": design_system,
            "patternCatalog": patterns,
            "variants": variants,
        }
    )
