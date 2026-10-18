"""I resolve text metrics through slide, layout and master before estimating capacity."""

from typing import Any

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


def inherited_shapes(shape: Any, slide: Any) -> list[Any]:
    chain = [shape]
    if not shape.is_placeholder:
        return chain
    idx = shape.placeholder_format.idx
    kind = shape.placeholder_format.type
    for parent in [slide.slide_layout, slide.slide_layout.slide_master]:
        found = next((s for s in parent.placeholders if s.placeholder_format.idx == idx), None)
        if found is None:
            found = next(
                (s for s in parent.placeholders if s.placeholder_format.type == kind), None
            )
        if found is not None:
            chain.append(found)
    return chain


def text_metrics(shape: Any, slide: Any) -> dict[str, Any]:
    """I retain the resolved size, family, line rhythm and actual text insets."""
    chain = inherited_shapes(shape, slide)
    properties = []
    paragraph_properties = []
    for item in chain:
        body = item._element.find(f"{_P}txBody")
        if body is None:
            continue
        for paragraph in body.findall(f"{_A}p"):
            pp = paragraph.find(f"{_A}pPr")
            if pp is not None:
                paragraph_properties.append(pp)
            properties.extend(paragraph.findall(f"{_A}r/{_A}rPr"))
            properties.extend(paragraph.findall(f"{_A}pPr/{_A}defRPr"))
            if item is shape:
                # An empty placeholder carries the size its text will take in endParaRPr.
                properties.extend(paragraph.findall(f"{_A}endParaRPr"))
        level = body.find(f"{_A}lstStyle/{_A}lvl1pPr")
        if level is not None:
            paragraph_properties.append(level)
            properties.extend(level.findall(f"{_A}defRPr"))
    kind = "otherStyle"
    if shape.is_placeholder:
        kind = (
            "titleStyle"
            if str(shape.placeholder_format.type).startswith(("TITLE", "CENTER_TITLE"))
            else "bodyStyle"
        )
    master_level = slide.slide_layout.slide_master._element.find(
        f"{_P}txStyles/{_P}{kind}/{_A}lvl1pPr"
    )
    if master_level is not None:
        properties.extend(master_level.findall(f"{_A}defRPr"))
        paragraph_properties.append(master_level)
    size = next((float(p.get("sz")) / 100 for p in properties if p.get("sz")), 18.0)
    font = next(
        (
            p.find(f"{_A}latin").get("typeface")
            for p in properties
            if p.find(f"{_A}latin") is not None
        ),
        "",
    )
    if not font or font.startswith("+"):
        theme_rel = next(
            (
                r
                for r in slide.slide_layout.slide_master.part.rels.values()
                if r.reltype.endswith("/theme")
            ),
            None,
        )
        if theme_rel is not None:
            import lxml.etree as etree

            theme = etree.fromstring(theme_rel.target_part.blob)
            family = "majorFont" if font.startswith("+mj") or kind == "titleStyle" else "minorFont"
            latin = theme.find(f".//{_A}fontScheme/{_A}{family}/{_A}latin")
            if latin is not None:
                font = latin.get("typeface", "")
    spacing = 1.15
    before = after = 0.0
    indent = 0.0
    for pp in reversed(paragraph_properties):
        line = pp.find(f"{_A}lnSpc/{_A}spcPct")
        fixed = pp.find(f"{_A}lnSpc/{_A}spcPts")
        if line is not None:
            spacing = float(line.get("val", "100000")) / 100000
        elif fixed is not None:
            spacing = float(fixed.get("val", "0")) / 100 / size
        for field, tag in [("before", "spcBef"), ("after", "spcAft")]:
            value = pp.find(f"{_A}{tag}/{_A}spcPts")
            if value is not None:
                if field == "before":
                    before = float(value.get("val", "0")) / 100
                else:
                    after = float(value.get("val", "0")) / 100
        if pp.get("marL"):
            indent = max(0.0, float(pp.get("marL")) / 12700)
    frame = shape.text_frame
    width = max(1.0, (shape.width - frame.margin_left - frame.margin_right) / 12700 - indent)
    height = max(1.0, (shape.height - frame.margin_top - frame.margin_bottom) / 12700)
    return {
        "font": font,
        "fontSize": size,
        "lineSpacing": spacing,
        "spaceBeforePt": before,
        "spaceAfterPt": after,
        "textWidthPt": width,
        "textHeightPt": height,
    }
