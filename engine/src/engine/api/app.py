"""FastAPI application of the engine."""

import time
from pathlib import Path

from fastapi import FastAPI, HTTPException

from engine import __version__, export, layout, parser
from engine.contracts import (
    DeckPlan,
    EditableDeckRequest,
    EditableDeckResponse,
    HealthCheck,
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
