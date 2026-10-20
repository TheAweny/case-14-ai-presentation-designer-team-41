"""Rules a brandbook implies when it declares none: the palette of its logos, the font it ships.

A brandbook that is only logos, pictures and font files states no rule, yet its colours are not
random: the same few paints recur across every logo, and its examples are drawn in them. This
module reads those recurrences into a small set of rules marked `inferred`, each with the files
it came from. Declared rules always win; inferred ones are used only when nothing is declared.
"""

import colorsys
from collections import Counter, defaultdict

#: A paint at least this saturated is a brand colour; below it, a neutral (text, background).
SATURATED = 0.35
#: A raster pixel this close (RGB distance) to a logo colour is a vote for it.
NEAR = 70.0
#: A neutral this dark can be the text colour.
DARK = 0.3
#: A colour must appear in this many vector files to be the brand's rather than one picture's.
MIN_FILES = 2
INFERRED_CONFIDENCE = 0.6


def _rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def _hls(value: str) -> tuple[float, float, float]:
    red, green, blue = _rgb(value)
    return colorsys.rgb_to_hls(red / 255, green / 255, blue / 255)


def _distance(a: str, b: str) -> float:
    return sum((x - y) ** 2 for x, y in zip(_rgb(a), _rgb(b), strict=True)) ** 0.5


def _token(index: int, kind: str, value: str, role: str, sources: list[str], why: str) -> dict:
    return {
        "id": f"inferred-{index}",
        "name": f"inferred {role}",
        "kind": kind,
        "value": value,
        "unit": None,
        "role": role,
        "scope": "global",
        "authority": "inferred",
        "confidence": INFERRED_CONFIDENCE,
        "evidence": [
            {"sourceId": source, "locator": "inferred", "excerpt": why[:4000]}
            for source in sources[:5]
        ],
    }


def infer_rules(tokens: list[dict], assets: list[dict], sources: list[dict]) -> list[dict]:
    """Inferred colour and font rules, or none when the brandbook gives too little to tell."""
    formats = {source["id"]: source.get("format", "") for source in sources}
    vector_files: dict[str, set[str]] = defaultdict(set)
    raster_votes: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for token in tokens:
        if token["kind"] != "color" or token["authority"] != "observed":
            continue
        value = str(token["value"]).upper()
        if len(value) != 7 or not value.startswith("#"):
            continue
        for evidence in token["evidence"]:
            source = evidence["sourceId"]
            if formats.get(source) == "svg":
                vector_files[value].add(source)
            elif evidence["locator"].startswith("pixels:"):
                share = float(evidence["locator"].split("=", 1)[1])
                raster_votes[value].append((source, share))

    brand = {value: files for value, files in vector_files.items() if len(files) >= MIN_FILES}
    rules: list[dict] = []
    accents = [value for value in brand if _hls(value)[2] >= SATURATED]
    neutrals = [value for value in brand if _hls(value)[2] < SATURATED]

    score: dict[str, float] = {value: float(len(brand[value])) for value in accents}
    voters: dict[str, set[str]] = {value: set(brand[value]) for value in accents}
    for colour, votes in raster_votes.items():
        if not accents:
            break
        nearest = min(accents, key=lambda accent: _distance(accent, colour))
        if _distance(nearest, colour) <= NEAR:
            for source, share in votes:
                score[nearest] += share
                voters[nearest].add(source)
    # Most recurring first; a tie goes to the colour the pictures show more, then by its code.
    ranked = sorted(accents, key=lambda value: (-score[value], value))
    for role, value in zip(("primary", "secondary"), ranked, strict=False):
        why = f"{value} recurs in {len(brand[value])} logo file(s)" + (
            " and dominates the brand's pictures" if voters[value] - brand[value] else ""
        )
        rules.append(_token(len(rules), "color", value, role, sorted(voters[value]), why))
    if ranked:
        why = f"{ranked[0]} is the brand's main colour; headings take it, as in its examples"
        rules.append(
            _token(len(rules), "color", ranked[0], "heading", sorted(voters[ranked[0]]), why)
        )
    dark = sorted(
        (value for value in neutrals if _hls(value)[1] <= DARK),
        key=lambda value: (-len(brand[value]), _hls(value)[1]),
    )
    if dark:
        why = f"{dark[0]} is the darkest neutral of {len(brand[dark[0]])} logo file(s)"
        rules.append(_token(len(rules), "color", dark[0], "text", sorted(brand[dark[0]]), why))

    families: Counter[str] = Counter()
    family_sources: dict[str, list[str]] = defaultdict(list)
    for asset in assets:
        family = asset.get("fontFamily")
        if asset.get("kind") == "font" and family:
            families[family] += 1
            family_sources[family].append(asset["sourceId"])
    if families:
        # The family with most files; of equals, the plain one («Mono» over «Mono NL»).
        family = min(families, key=lambda name: (-families[name], len(name), name))
        why = f"{family} is the font the brandbook ships ({families[family]} file(s))"
        rules.append(_token(len(rules), "font-family", family, "all", family_sources[family], why))
    return rules
