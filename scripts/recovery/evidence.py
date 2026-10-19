"""Inspect final PPTX files and make a contact sheet of their real LibreOffice previews."""

import copy
import json
import re
from pathlib import Path

from engine.parser import import_deck
from engine.visuals import structural_signature
from PIL import Image, ImageDraw


def collect(root: Path) -> None:
    build = json.loads((root / "runtime-build.json").read_text())["build"]
    sheet = Image.new("RGB", (1080, 5 * 225), "#eceae5")
    draw = ImageDraw.Draw(sheet)
    variants = []
    for column, variant in enumerate(build["variants"]):
        directory = root / variant["runId"]
        slides = import_deck(directory / "deck.pptx")
        assert len(slides) == 5
        elements = []
        text = []
        for index, slide in enumerate(slides):
            for element in slide["elements"]:
                if element["kind"] == "text":
                    text.extend(run["text"] for p in element["paragraphs"] for run in p["runs"])
                shifted = copy.deepcopy(element)
                shifted["box"]["y"] += index * slide["slideCy"]
                elements.append(shifted)
            with Image.open(directory / "previews" / f"slide-{index + 1}.png") as preview:
                preview.thumbnail((340, 192))
                x, y = column * 360 + 10, index * 225 + 24
                sheet.paste(preview.convert("RGB"), (x, y))
                draw.text((x, y - 18), f"{variant['variant']} / {index + 1}", fill="#202d3c")
        joined = " ".join(text)
        assert "98" in joined and "2026" in joined and "пилот" in joined.lower()
        assert set(re.findall(r"\d+", joined)) <= {"98", "2026"}
        signature = structural_signature(elements)["digest"]
        # Reversing independent elements and recolouring them must not create a new concept.
        control = copy.deepcopy(list(reversed(elements)))
        for element in control:
            if element["kind"] == "text":
                for paragraph in element["paragraphs"]:
                    for run in paragraph["runs"]:
                        run["color"], run["font"] = "FF00AA", "Control Face"
        assert structural_signature(control)["digest"] == signature
        review = json.loads((directory / "final-review.json").read_text())
        variants.append(
            {
                **variant,
                "slides": len(slides),
                "signature": signature,
                "cosmeticControlCollapsed": True,
                "numbersUnitsPreserved": "98 % / 2026",
                "finalReview": review,
            }
        )
    distinct = len({v["signature"] for v in variants}) == 3
    report = {
        "variants": variants,
        "threeStructuralDesigns": distinct,
        "contextualAudit": "unknown: no live visual reviewer",
        "SLA": "not established by fake responses",
    }
    (root / "artifact-evidence.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    sheet.save(root / "contact-sheet.png")
    print(
        json.dumps({"variants": len(variants), "slidesEach": 5, "threeStructuralDesigns": distinct})
    )


if __name__ == "__main__":
    import sys

    collect(Path(sys.argv[1]))
