"""FastAPI application of the engine."""

import base64
import hashlib
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from engine import __version__, checks, export, layout, parser, render, visuals
from engine.api._composition_audit import composition_slides
from engine.api._profiles import UnknownProfileError, deterministic_profile
from engine.contracts import (
    AuditReport,
    AuditRequest,
    DeckExportRequest,
    DeckExportResponse,
    DeckImportRequest,
    DeckImportResponse,
    DeckPlan,
    EditableDeckRequest,
    EditableDeckResponse,
    HealthCheck,
    LayoutVariantsRequest,
    LayoutVariantsResponse,
    SlideIR,
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


def bundle_previews(previews: list[Path], output: Path) -> Path:
    """Write the rendered slides into one portable PNG archive."""
    if not previews:
        raise ValueError("Cannot create a PNG archive without rendered slides.")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for preview in previews:
            archive.write(preview, preview.name)
    return output


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
    "/v1/deck-import",
    response_model=DeckImportResponse,
    # SlideIR tells an absent field from a null one; unset optional fields must stay absent.
    response_model_exclude_unset=True,
    summary="Read a finished PPTX back as SlideIR, the way its slides are drawn",
)
def deck_import(request: DeckImportRequest) -> DeckImportResponse:
    """Every slide of a deck as editable elements, with the pictures it draws written out.

    The editor opens a generated deck from this, so it shows what the file and its PDF show:
    what the master and layout put on each slide, text in the size, colour and typeface it is
    drawn in, the picture behind it and the outline of every shape.
    """
    path = Path(request.pptxPath).resolve()
    if not path.is_file():
        raise HTTPException(status_code=422, detail=f"PPTX was not found: {request.pptxPath}")
    media_dir = Path(request.mediaDir).resolve() if request.mediaDir else None
    try:
        slides = parser.import_deck(path, media_dir)
    except TemplateParseError as error:
        raise HTTPException(status_code=422, detail=f"PPTX cannot be read: {error}") from error
    return DeckImportResponse.model_validate({"schemaVersion": 1, "slides": slides})


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
    slide_ir = _styled(layout.build_slide_ir(plan, design_system, patterns), design_system)
    export.export_pptx(slide_ir, design_system, template_path, output_path, visuals.draw_visual)
    return EditableDeckResponse.model_validate(
        {
            "schemaVersion": 1,
            "outputPath": str(output_path),
            "designSystem": design_system,
            "slideCount": len(slide_ir),
        }
    )


@app.post(
    "/v1/generation-profile",
    response_model=GenerationProfile,
    # Optional slot fields such as prompt stay absent when unset: TypeScript rejects a null.
    response_model_exclude_unset=True,
)
def generation_profile(request: TemplateProfileRequest) -> dict:
    """Prepare exact reusable compositions before the timed generation request."""
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
    """Check every binding against the source typography before writing a file."""
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


@app.post(
    "/v1/composition-decks",
    response_model=CompositionExportResponse,
    # TemplateIR tells an absent paragraph field from a null one. Pydantic defaults such as
    # bullet and marginEmu must stay absent, or the TypeScript schema rejects the export.
    response_model_exclude_unset=True,
)
def composition_deck(request: CompositionExportRequest) -> dict:
    """Join independent document layers for a template-faithful editable export.

    A template family that is not installed does not stop the export. The file keeps that
    family name; the preview may draw a substitute, and the response names the gap.
    """
    source = Path(request.templatePath).resolve()
    output = Path(request.outputPath).resolve()
    findings = composition_check(request)["findings"]
    if findings:
        raise HTTPException(status_code=422, detail=findings)
    missing: list[str] = []
    try:
        patterns = extract_compositions(source)
        selected = {slide.patternId for slide in request.slides}
        missing = render.missing_fonts(
            {
                slot["font"]
                for pattern in patterns
                if pattern["patternId"] in selected
                for slot in pattern["slots"]
            }
        )
        design_system = parser.design_system_of(source)

        def draw(shapes: Any, element: dict[str, Any]) -> None:
            styled = visuals.style_visuals([{"elements": [element]}], design_system)
            visuals.draw_visual(shapes, styled[0]["elements"][0], design_system)

        export_compositions(
            source, output, [s.model_dump(mode="json") for s in request.slides], patterns, draw
        )
        previews = render.render_to_png(output, output.parent / "previews", dpi=110)
        ir = parser.parse_template(output)
        with zipfile.ZipFile(output) as archive:
            media_dir = output.parent / "media"
            media_dir.mkdir(exist_ok=True)
            for entry in archive.namelist():
                if entry.startswith("ppt/media/") and not entry.endswith("/"):
                    (media_dir / Path(entry).name).write_bytes(archive.read(entry))
        bundle_previews(previews, output.parent / "slides.zip")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    warnings = ["Image generation is mocked; existing template artwork is preserved."]
    if missing:
        warnings.append(
            "Fonts not installed on the render server: "
            f"{', '.join(missing)}. "
            "The .pptx keeps the template fonts; previews use substitutes."
        )
    return {
        "schemaVersion": 1,
        "outputPath": str(output),
        "templateIr": ir,
        "previews": [str(p) for p in previews],
        "pdfPath": str(output.parent / "previews" / f"{output.stem}.pdf"),
        "warnings": warnings,
        "missingFonts": missing,
    }


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
    # SlideIR tells an absent field from a null one; unset optional fields must stay absent.
    response_model_exclude_unset=True,
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
    # SlideIR tells an absent field from a null one; unset optional fields must stay absent.
    response_model_exclude_unset=True,
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
                for slide in _styled(
                    layout.build_slide_ir(plan, design_system, patterns, variant), design_system
                )
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


def _styled(slides: list[SlideIR], design_system: dict[str, Any]) -> list[SlideIR]:
    """Slides with their tables and charts given the template's look by the visuals layer."""
    dumped = [slide.model_dump(mode="json", exclude_unset=True) for slide in slides]
    return [SlideIR.model_validate(s) for s in visuals.style_visuals(dumped, design_system)]


@app.post(
    "/v1/exports",
    response_model=DeckExportResponse,
    # SlideIR tells an absent field from a null one; unset optional fields must stay absent.
    response_model_exclude_unset=True,
    summary="Write slides onto their template as native PPTX, and PDF from it",
)
def export_deck(request: DeckExportRequest) -> DeckExportResponse:
    """Write one variant's slides as files, tables and charts as native objects."""
    template_path = Path(request.templatePath).resolve()
    if not template_path.is_file():
        raise HTTPException(status_code=404, detail="Template PPTX was not found.")
    design_system, _ = parser.template_profile_of(template_path)
    variant = str(getattr(request.variant, "value", request.variant))
    slides = [
        SlideIR.model_validate(slide.model_dump(mode="json", exclude_unset=True))
        for slide in request.slides
    ]
    formats = [str(getattr(f, "value", f)) for f in request.formats or ["pptx", "pdf"]]
    # A PPTX download does not need PNG previews, and a PDF download needs no second pass:
    # the API sets this per requested format so an export pays only for what it returns.
    previews = request.previews is not False
    output_dir = Path(request.outputDir).resolve()
    pptx_path = export.export_pptx(
        _styled(slides, design_system),
        design_system,
        template_path,
        output_dir / f"{variant}.pptx",
        visuals.draw_visual,
    )
    files = [{"format": "pptx", "path": str(pptx_path)}] if "pptx" in formats else []
    if "pdf" in formats:
        try:
            pdf_path = export.export_pdf(pptx_path, output_dir / f"{variant}.pdf")
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        files.append({"format": "pdf", "path": str(pdf_path)})
        if previews:
            # The previews reuse the PDF the download already paid for: one LibreOffice pass.
            try:
                render.rasterize_pdf(pdf_path, output_dir / "previews", dpi=110)
            except (ValueError, FileNotFoundError, subprocess.SubprocessError) as error:
                raise HTTPException(status_code=503, detail=str(error)) from error
    elif previews:
        # HTML and PNG downloads are built from the previews; the PDF is only the render stage.
        try:
            render.render_to_png(pptx_path, output_dir / "previews", dpi=110)
        except (ValueError, FileNotFoundError, subprocess.SubprocessError) as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
    return DeckExportResponse.model_validate(
        {"schemaVersion": 1, "variant": variant, "files": files}
    )


@app.post(
    "/v1/composition-audit",
    response_model=AuditReport,
    # SlideIR tells an absent field from a null one; unset optional fields must stay absent.
    response_model_exclude_unset=True,
)
def composition_audit(request: CompositionExportRequest) -> AuditReport:
    """Audit a deck exported from compositions, measuring the written file.

    Only the slots are judged: the rest of each slide is the template's own design. The
    `composition` profile leaves out what the typographic fit check already covers exactly and
    what would flag the template's own geometry.
    """
    source = Path(request.templatePath).resolve()
    output = Path(request.outputPath).resolve()
    if not source.is_file() or not output.is_file():
        raise HTTPException(status_code=404, detail="Template or exported deck not found.")
    patterns = {p["patternId"]: p for p in extract_compositions(source)}
    slides = composition_slides(
        parser.parse_template(output), [s.model_dump(mode="json") for s in request.slides], patterns
    )
    payload = {
        "schemaVersion": 1,
        "deckId": output.parent.name,
        "slides": slides,
        "designSystem": parser.design_system_of(source),
        "patternCatalog": None,
    }
    try:
        profile = deterministic_profile("composition")
    except UnknownProfileError:
        profile = {}
    return AuditReport.model_validate(checks.audit_deck(payload, "composition", profile))
