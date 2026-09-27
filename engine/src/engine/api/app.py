"""FastAPI application of the engine."""

import base64
import hashlib
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from engine import __version__, export, layout, parser, render
from engine.contracts import (
    DeckPlan,
    EditableDeckRequest,
    EditableDeckResponse,
    HealthCheck,
    Status,
)
from engine.contracts._generated import (
    CompositionCheckResponse,
    CompositionExportRequest,
    CompositionExportResponse,
    GenerationProfile,
)
from engine.export.compositions import export_compositions
from engine.layout.text_fit import check_composition_text
from engine.parser._errors import TemplateParseError
from engine.parser.compositions import extract_compositions

_STARTED_AT = time.monotonic()


class TemplateProfileRequest(BaseModel):
    template_path: str


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
    "/v1/template-profile",
    response_model=dict,
    summary="Parse a saved PPTX template and return its profile",
)
def template_profile(request: TemplateProfileRequest) -> dict:
    """Return the deterministic parser output for a saved template file."""
    path = Path(request.template_path).resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Template PPTX was not found.")
    try:
        design_system = parser.design_system_of(path)
        # Use the public parser entrypoint so the canonical IR digest is included in the payload.
        template_ir = parser.parse_template(path)
    except (OSError, ValueError, TemplateParseError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    preview_data_url: str | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="template-preview-") as directory:
            rendered = render.render_to_png(
                path, Path(directory), dpi=96, first_slide_only=True, timeout_seconds=20
            )
            if rendered:
                preview_data_url = "data:image/png;base64," + base64.b64encode(
                    rendered[0].read_bytes()
                ).decode("ascii")
    except (OSError, subprocess.SubprocessError, ValueError):
        # A profile remains useful when a headless renderer is unavailable.
        preview_data_url = None
    return {
        "designSystem": design_system,
        "templateIr": template_ir,
        "previewDataUrl": preview_data_url,
    }


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

    design_system = parser.design_system_of(template_path)
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
    slide_ir = layout.build_slide_ir(plan, design_system)
    export.export_pptx(slide_ir, design_system, template_path, output_path)
    return EditableDeckResponse.model_validate(
        {
            "schemaVersion": 1,
            "outputPath": str(output_path),
            "designSystem": design_system,
            "slideCount": len(slide_ir),
        }
    )


@app.post("/v1/generation-profile", response_model=GenerationProfile)
def generation_profile(request: TemplateProfileRequest) -> dict:
    """I prepare exact reusable compositions before the timed generation request."""
    path = Path(request.template_path).resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Template not found.")
    return {
        "schemaVersion": 1,
        "templateHash": hashlib.sha256(path.read_bytes()).hexdigest(),
        "designSystem": parser.design_system_of(path),
        "compositions": extract_compositions(path),
    }


@app.post("/v1/composition-check", response_model=CompositionCheckResponse)
def composition_check(request: CompositionExportRequest) -> dict:
    """I check every binding against the source typography before writing a file."""
    source = Path(request.templatePath).resolve()
    if not source.is_file():
        raise HTTPException(status_code=404, detail="Template not found.")
    patterns = {p["patternId"]: p for p in extract_compositions(source)}
    findings = []
    for index, slide in enumerate(request.slides):
        pattern = patterns.get(slide.patternId)
        if pattern is None:
            raise HTTPException(status_code=422, detail="Unknown template composition.")
        texts = [t.model_dump() for t in slide.texts]
        if sorted(t["slotId"] for t in texts) != sorted(s["slotId"] for s in pattern["slots"]):
            raise HTTPException(status_code=422, detail="Bind every template slot exactly once.")
        findings.extend({**f, "slideIndex": index} for f in check_composition_text(pattern, texts))
    return {"schemaVersion": 1, "findings": findings}


@app.post("/v1/composition-decks", response_model=CompositionExportResponse)
def composition_deck(request: CompositionExportRequest) -> dict:
    """I join independent document layers for a template-faithful editable export."""
    source = Path(request.templatePath).resolve()
    output = Path(request.outputPath).resolve()
    findings = composition_check(request)["findings"]
    if findings:
        raise HTTPException(status_code=422, detail=findings)
    try:
        patterns = extract_compositions(source)
        selected = {slide.patternId for slide in request.slides}
        render.require_fonts(
            {
                slot["font"]
                for pattern in patterns
                if pattern["patternId"] in selected
                for slot in pattern["slots"]
            }
        )
        export_compositions(source, output, [s.model_dump() for s in request.slides], patterns)
        previews = render.render_to_png(output, output.parent / "previews", dpi=110)
        ir = parser.parse_template(output)
        import zipfile

        with zipfile.ZipFile(output) as archive:
            media_dir = output.parent / "media"
            media_dir.mkdir(exist_ok=True)
            for entry in archive.namelist():
                if entry.startswith("ppt/media/") and not entry.endswith("/"):
                    (media_dir / Path(entry).name).write_bytes(archive.read(entry))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "schemaVersion": 1,
        "outputPath": str(output),
        "templateIr": ir,
        "previews": [str(p) for p in previews],
        "pdfPath": str(output.parent / "previews" / f"{output.stem}.pdf"),
        "warnings": ["Image generation is mocked; existing template artwork is preserved."],
    }
