"""Evaluates the three layout variants on templates of different styles, without a model.

A fixed plan, with text, figures, a table and a chart, is laid out as every variant on each
template, audited, exported and read back. What is scored is what the case asks of the result:
the file is editable, text fits, the audit finds no blocker, the variants differ and say the
same thing. Three templates of different styles are generated so the run needs nothing that
cannot be committed; `--templates DIR` evaluates your own templates instead.

    uv run evaluate-variants
    uv run evaluate-variants --templates ~/templates
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from engine.api._profiles import deterministic_profile
from engine.checks import audit_deck
from engine.contracts import DeckPlan, SlideIR
from engine.export import export_pptx
from engine.layout import VARIANTS, build_variants, fingerprint
from engine.parser import template_profile_of
from engine.visuals import draw_visual, style_visuals
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.util import Emu, Pt

__all__ = ["EVAL_PLAN", "Score", "build_style_templates", "evaluate", "main"]

_SOURCE = [{"itemId": "doc1-p1", "quote": "Retention rose to 94%"}]


def _slide(i: int, intent: str, headline: str, *blocks: dict[str, Any]) -> dict[str, Any]:
    return {
        "slideId": f"s{i}",
        "intent": intent,
        "headline": headline,
        "subhead": "",
        "blocks": list(blocks),
        "speakerNotes": "",
        "sources": [],
    }


#: What every template is evaluated on: one slide of each kind a deck is made of.
EVAL_PLAN = DeckPlan.model_validate(
    {
        "schemaVersion": 1,
        "planId": "eval-plan",
        "briefId": "eval",
        "title": "Pilot results",
        "language": "en",
        "slides": [
            _slide(1, "title", "The pilot paid off"),
            _slide(
                2,
                "statement",
                "Decks are still laid out by hand",
                {"kind": "paragraph", "text": "Every deck goes from text to manual layout."},
            ),
            _slide(
                3,
                "bullets",
                "The template is read as rules",
                {
                    "kind": "bullets",
                    "items": [
                        "Palette and type scale",
                        "Grid and margins",
                        "Recurring layouts",
                        "Logo and footer zones",
                        "Three variants from one plan",
                    ],
                },
            ),
            _slide(
                4,
                "kpi",
                "Retention held in every segment",
                {
                    "kind": "kpi",
                    "items": [
                        {"value": "94%", "caption": "Retention", "sources": _SOURCE},
                        {"value": "12%", "caption": "Revenue growth", "sources": _SOURCE},
                    ],
                },
            ),
            _slide(
                5,
                "table",
                "Every segment beat its plan",
                {
                    "kind": "table",
                    "headers": ["Segment", "Plan", "Actual"],
                    "rows": [
                        ["Small", "85%", "91%"],
                        ["Mid", "88%", "93%"],
                        ["Large", "90%", "96%"],
                    ],
                    "sources": _SOURCE,
                },
            ),
            _slide(
                6,
                "chart",
                "Revenue grew three quarters running",
                {
                    "kind": "chart",
                    "chartType": "column",
                    "categories": ["Q1", "Q2", "Q3"],
                    "series": [{"name": "Revenue", "values": [10, 12, 15]}],
                    "xTitle": "Quarter",
                    "yTitle": "Revenue, mln",
                    "sources": _SOURCE,
                },
            ),
            _slide(7, "closing", "Extend the pilot"),
        ],
    }
)


def _style(presentation: Any, background: str, text: str, font: str) -> None:
    master = presentation.slide_master
    master.background.fill.solid()
    master.background.fill.fore_color.rgb = RGBColor.from_string(background)
    for shape in master.placeholders:
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs or []:
                run.font.color.rgb = RGBColor.from_string(text)
                run.font.name = font
    for layout in presentation.slide_layouts:
        for shape in layout.placeholders:
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs or []:
                    run.font.color.rgb = RGBColor.from_string(text)
                    run.font.name = font
                    run.font.size = run.font.size or Pt(20)


def build_style_templates(directory: Path) -> list[Path]:
    """Three templates that differ in the ways real ones do: aspect, tone, fonts, layout set."""
    directory.mkdir(parents=True, exist_ok=True)
    light = Presentation()
    light.save(str(directory / "light-4x3.pptx"))

    dark = Presentation()
    dark.slide_width, dark.slide_height = Emu(12_192_000), Emu(6_858_000)
    _style(dark, "101418", "E8ECEF", "Arial")
    dark.save(str(directory / "dark-16x9.pptx"))

    compact = Presentation()
    compact.slide_width, compact.slide_height = Emu(12_192_000), Emu(6_858_000)
    for layout in list(compact.slide_layouts):
        if layout.name not in {"Title Slide", "Title and Content", "Title Only", "Blank"}:
            compact.slide_layouts.remove(layout)
    _style(compact, "FFFFFF", "1A2B4C", "Georgia")
    compact.save(str(directory / "compact-16x9.pptx"))
    return sorted(directory.glob("*.pptx"))


@dataclass(frozen=True, slots=True)
class Score:
    """How one variant of the plan came out on one template."""

    template: str
    variant: str
    slides: int
    overflows: int
    audit_score: float
    blockers: int
    majors: int
    native_tables: int
    native_charts: int
    picture_slides: int
    distinct: bool
    same_text: bool

    @property
    def ok(self) -> bool:
        """What a variant must satisfy: editable, native visuals, no blocker, distinct, faithful."""
        return (
            self.picture_slides == 0
            and self.native_tables >= 1
            and self.native_charts >= 1
            and self.blockers == 0
            and self.distinct
            and self.same_text
        )


def _texts(slides: list[SlideIR]) -> list[str]:
    return sorted(
        run["text"]
        for slide in slides
        for element in slide.model_dump(mode="json")["elements"]
        for paragraph in element.get("paragraphs") or []
        for run in paragraph["runs"]
    )


def _read_back(path: Path) -> tuple[int, int, int]:
    """Native tables, native charts and slides that are nothing but a picture, in a written file."""
    tables = charts = pictures = 0
    for slide in Presentation(str(path)).slides:
        shapes = list(slide.shapes)
        tables += sum(1 for s in shapes if getattr(s, "has_table", False))
        charts += sum(1 for s in shapes if getattr(s, "has_chart", False))
        if shapes and all(s.shape_type == MSO_SHAPE_TYPE.PICTURE for s in shapes):
            pictures += 1
    return tables, charts, pictures


def evaluate(templates: list[Path], workdir: Path) -> list[Score]:
    """Score every variant of the evaluation plan on every template."""
    profile = deterministic_profile("default")
    scores: list[Score] = []
    for template in templates:
        design_system, patterns = template_profile_of(template)
        variants = build_variants(EVAL_PLAN, design_system, patterns)
        prints = {name: fingerprint(slides) for name, slides in variants.items()}
        texts = {name: _texts(slides) for name, slides in variants.items()}
        for name in VARIANTS:
            dumped = style_visuals(
                [s.model_dump(mode="json", exclude_unset=True) for s in variants[name]],
                design_system,
            )
            report = audit_deck(
                {
                    "deckId": f"{template.stem}-{name}",
                    "slides": dumped,
                    "designSystem": design_system,
                    "patternCatalog": patterns,
                },
                "default",
                profile,
            )
            out = export_pptx(
                [SlideIR.model_validate(s) for s in dumped],
                design_system,
                template,
                workdir / f"{template.stem}-{name}.pptx",
                draw_visual,
            )
            tables, charts, pictures = _read_back(out)
            scores.append(
                Score(
                    template=template.stem,
                    variant=name,
                    slides=len(dumped),
                    overflows=sum(1 for s in dumped for e in s["elements"] if e.get("overflow")),
                    audit_score=report["score"],
                    blockers=report["counts"]["blocker"],
                    majors=report["counts"]["major"],
                    native_tables=tables,
                    native_charts=charts,
                    picture_slides=pictures,
                    distinct=sum(1 for p in prints.values() if p == prints[name]) == 1,
                    same_text=all(t == texts[name] for t in texts.values()),
                )
            )
    return scores


def _table(scores: list[Score]) -> str:
    header = (
        "template            variant   slides overflow audit blockers majors "
        "tables charts pictures distinct same-text  ok"
    )
    rows = [header, "-" * len(header)]
    for s in scores:
        rows.append(
            f"{s.template:<19} {s.variant:<9} {s.slides:>6} {s.overflows:>8} {s.audit_score:>5.1f} "
            f"{s.blockers:>8} {s.majors:>6} {s.native_tables:>6} {s.native_charts:>6} "
            f"{s.picture_slides:>8} {s.distinct!s:>8} {s.same_text!s:>9} "
            f"{'yes' if s.ok else 'NO':>3}"
        )
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    """Print the evaluation table; exit 1 when a variant misses what it must satisfy."""
    parser = argparse.ArgumentParser(prog="evaluate-variants", description=__doc__)
    parser.add_argument("--templates", type=Path, help="Directory of .pptx templates to use.")
    args = parser.parse_args(argv)
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        if args.templates:
            templates = sorted(args.templates.glob("*.pptx"))
        else:
            templates = build_style_templates(workdir / "templates")
        if not templates:
            print("No .pptx templates found.", file=sys.stderr)
            return 2
        scores = evaluate(templates, workdir)
    print(_table(scores))
    return 0 if all(s.ok for s in scores) else 1
