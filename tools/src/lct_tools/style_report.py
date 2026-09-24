"""Renders a template's design system as one HTML page a person can check at a glance.

The JSON is what the renderer reads; this is what a designer reads. Every token is shown with
the evidence behind it, so a low-confidence guess looks like one: its bar is short and its
warning is listed under it, rather than a swatch that looks exactly as sure as the others.
"""

from __future__ import annotations

import argparse
import json
from html import escape
from pathlib import Path
from typing import Any

from engine.parser import design_system_of

__all__ = ["main", "render_style_report"]

_EMU_PER_PT = 12_700
_LOW = 0.5

_CSS = """
:root { --fg: #1c1d21; --muted: #5e6470; --line: #d9dce1; --bg: #ffffff; --warn: #b3261e; }
body { font: 14px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg);
       margin: 0 auto; max-width: 1040px; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 12px; }
.sub { color: var(--muted); margin: 0 0 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.swatch { height: 56px; } .body { padding: 8px 10px; }
.role { font-weight: 600; } .hex { font-family: ui-monospace, monospace; color: var(--muted); }
.meta { font-size: 12px; color: var(--muted); }
.bar { height: 4px; background: var(--line); border-radius: 2px; margin-top: 6px; }
.bar > i { display: block; height: 100%; border-radius: 2px; background: #2e7d32; }
.bar.low > i { background: var(--warn); }
.surface { padding: 16px; border-radius: 8px; border: 1px solid var(--line); }
.chip { display: inline-block; padding: 2px 8px; border-radius: 4px; margin-top: 8px; }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line);
         vertical-align: baseline; }
th { font-weight: 600; color: var(--muted); font-size: 12px; }
.sample { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 520px; }
svg { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; }
.warn li { margin-bottom: 4px; } .code { font-family: ui-monospace, monospace; font-size: 12px; }
.low { color: var(--warn); }
"""

_ZONE_COLOURS = {
    "logo": "#d81b60",
    "footer": "#6d4c41",
    "page-number": "#3949ab",
    "decoration": "#8e24aa",
}


def _bar(meta: dict[str, Any]) -> str:
    confidence = float(meta["confidence"])
    low = " low" if confidence < _LOW else ""
    return f'<div class="bar{low}"><i style="width:{confidence * 100:.0f}%"></i></div>'


def _evidence(meta: dict[str, Any]) -> str:
    confidence = float(meta["confidence"])
    cls = ' class="low"' if confidence < _LOW else ""
    return (
        f"<span{cls}>{escape(meta['source'])} · {meta['count']} obs · "
        f"share {meta['share']:.0%} · conf {confidence:.2f}</span>"
    )


def _palette(ds: dict[str, Any]) -> str:
    cards = []
    for entry in ds["palette"]:
        cards.append(
            f'<div class="card"><div class="swatch" style="background:#{entry["hex"]}"></div>'
            f'<div class="body"><div class="role">{escape(entry["role"])}</div>'
            f'<div class="hex">#{entry["hex"]}</div>'
            f'<div class="meta">{_evidence(entry["meta"])}</div>{_bar(entry["meta"])}</div></div>'
        )
    return f'<div class="grid">{"".join(cards)}</div>'


def _surfaces(ds: dict[str, Any], font: str) -> str:
    cards = []
    for surface in ds["surfaces"]:
        accent = surface["accent"]
        chip = (
            f'<span class="chip" style="background:#{accent};color:#{surface["background"]}">'
            f"accent #{accent}</span>"
            if accent
            else '<span class="meta">no accent observed on this surface</span>'
        )
        cards.append(
            f'<div><div class="surface" style="background:#{surface["background"]};'
            f'color:#{surface["text"]};font-family:{escape(font)!r}">'
            f'<div class="role">{escape(surface["tone"])} surface</div>'
            f"<div>Text #{surface['text']} on #{surface['background']}</div>{chip}</div>"
            f'<div class="meta">{_evidence(surface["meta"])}</div>{_bar(surface["meta"])}</div>'
        )
    return f'<div class="grid">{"".join(cards)}</div>'


def _type(ds: dict[str, Any]) -> str:
    families = ", ".join(
        f"{escape(f['role'])}: <b>{escape(f['font'])}</b>"
        + (
            f" (theme says {escape(f['declared'])})"
            if f["declared"] and f["declared"] != f["font"]
            else ""
        )
        for f in ds["typeFamilies"]
    )
    rows = []
    for style in ds["typeScale"]:
        weight = 700 if style["bold"] else 400
        size = min(float(style["sizePt"]), 72.0)
        rows.append(
            f"<tr><td class='role'>{escape(style['role'])}</td>"
            f"<td class='hex'>{style['sizePt']:g} pt · {style['lineSpacing']:g}×"
            f"{' · bold' if style['bold'] else ''}</td>"
            f"<td><div class='sample' style=\"font-family:{escape(style['font'])!r};"
            f'font-size:{size:g}pt;font-weight:{weight}">{escape(style["font"])}</div></td>'
            f"<td class='meta'>{_evidence(style['meta'])}{_bar(style['meta'])}</td></tr>"
        )
    return (
        f'<p class="sub">{families}</p><table><tr><th>role</th><th>size</th><th>sample</th>'
        f"<th>evidence</th></tr>{''.join(rows)}</table>"
    )


def _layout(ds: dict[str, Any]) -> str:
    grid = ds["grid"]
    width, height = grid["slideCx"], grid["slideCy"]
    left, right = grid["marginLeft"], grid["marginRight"]
    top, bottom = grid["marginTop"], grid["marginBottom"]
    content = width - left - right
    gutter = grid["gutter"]
    columns = grid["columns"]
    column = (content - gutter * (columns - 1)) / columns
    background = next((p["hex"] for p in ds["palette"] if p["role"] == "background"), "FFFFFF")
    stroke = max(width, height) / 600

    shapes = [f'<rect width="{width}" height="{height}" fill="#{background}"/>']
    for i in range(columns):
        x = left + i * (column + gutter)
        shapes.append(
            f'<rect x="{x:.0f}" y="{top}" width="{column:.0f}" '
            f'height="{height - top - bottom}" fill="#1e88e5" fill-opacity="0.08"/>'
        )
    shapes.append(
        f'<rect x="{left}" y="{top}" width="{content}" height="{height - top - bottom}" '
        f'fill="none" stroke="#1e88e5" stroke-width="{stroke:.0f}" '
        f'stroke-dasharray="{stroke * 4:.0f}"/>'
    )
    for zone in ds["protectedZones"]:
        box = zone["box"]
        colour = _ZONE_COLOURS[zone["role"]]
        shapes.append(
            f'<rect x="{box["x"]}" y="{box["y"]}" width="{box["cx"]}" height="{box["cy"]}" '
            f'fill="{colour}" fill-opacity="0.25" stroke="{colour}" '
            f'stroke-width="{stroke:.0f}"><title>{escape(zone["role"])}</title></rect>'
        )

    def inches(emu: int) -> str:
        return f"{emu / 914_400:.2f} in"

    legend = (
        f"Margins L {inches(left)} · R {inches(right)} · T {inches(top)} · B {inches(bottom)}; "
        f"{columns} columns, gutter {inches(gutter)}, baseline "
        f"{grid['baseline'] / _EMU_PER_PT:.1f} pt. {_evidence(grid['meta'])}"
    )
    zones = "".join(
        f"<tr><td><span style='color:{_ZONE_COLOURS[z['role']]}'>■</span> "
        f"{escape(z['role'])}</td><td class='hex'>{inches(z['box']['x'])}, "
        f"{inches(z['box']['y'])} · {inches(z['box']['cx'])} × {inches(z['box']['cy'])}</td>"
        f"<td class='hex'>{escape(z['mediaPart'])}</td>"
        f"<td class='meta'>{_evidence(z['meta'])}</td></tr>"
        for z in ds["protectedZones"]
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="grid and protected zones">'
        f"{''.join(shapes)}</svg><p class='meta'>{legend}</p>"
        + (
            f"<table><tr><th>zone</th><th>box</th><th>media</th><th>evidence</th></tr>{zones}</table>"
            if zones
            else "<p class='low'>No protected zones found.</p>"
        )
    )


def _details(ds: dict[str, Any]) -> str:
    strokes = ", ".join(
        f"{s['widthPt']:g} pt #{s['hex']}"
        + (f" ({escape(s['colorRole'])})" if s["colorRole"] else "")
        for s in ds["strokes"]
    )
    radii = ", ".join(f"{escape(r['name'])} {r['radiusPt']:g} pt" for r in ds["radii"])
    shadows = "used" if ds["shadows"]["present"] else "none; do not add any"
    return (
        f"<table><tr><td class='role'>strokes</td><td>{strokes or 'none'}</td></tr>"
        f"<tr><td class='role'>radii</td><td>{radii or 'square corners only'}</td></tr>"
        f"<tr><td class='role'>shadows</td><td>{shadows}</td></tr></table>"
    )


def _warnings(ds: dict[str, Any]) -> str:
    if not ds["warnings"]:
        return "<p>None: every token was measured with confidence.</p>"
    items = "".join(
        f"<li><span class='code'>{escape(w['code'])} · {escape(w['token'])}</span><br>"
        f"{escape(w['message'])}</li>"
        for w in ds["warnings"]
    )
    return f'<ul class="warn">{items}</ul>'


def render_style_report(ds: dict[str, Any], title: str) -> str:
    """One self-contained HTML page describing a design system, evidence included."""
    font = ds["typeFamilies"][0]["font"]
    low = sum(
        1
        for group in (ds["palette"], ds["typeScale"], ds["typeFamilies"])
        for token in group
        if token["meta"]["confidence"] < _LOW
    )
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{escape(title)} style</title><style>{_CSS}</style></head><body>"
        f"<h1>{escape(title)}</h1>"
        f"<p class='sub'>Aspect {escape(ds['aspect'])} · IR {ds['templateHash'][:12]} · "
        f"{len(ds['warnings'])} warnings · {low} low-confidence tokens</p>"
        f"<h2>Palette</h2>{_palette(ds)}"
        f"<h2>Surfaces</h2>{_surfaces(ds, font)}"
        f"<h2>Type</h2>{_type(ds)}"
        f"<h2>Grid and protected zones</h2>{_layout(ds)}"
        f"<h2>Strokes, corners, shadows</h2>{_details(ds)}"
        f"<h2>Warnings</h2>{_warnings(ds)}"
        "</body></html>\n"
    )


def main() -> int:
    """Extract a template's design system and write it as JSON plus an HTML report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", type=Path, help="the .pptx to read")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="directory to write <name>.design.json and <name>.style.html into "
        "(default: beside the template)",
    )
    parser.add_argument(
        "--fonts",
        nargs="*",
        default=None,
        help="fonts the renderer can draw; others are substituted and reported",
    )
    arguments = parser.parse_args()

    template: Path = arguments.template
    destination: Path = arguments.out or template.parent
    destination.mkdir(parents=True, exist_ok=True)
    ds = design_system_of(template, arguments.fonts)

    stem = template.stem
    json_path = destination / f"{stem}.design.json"
    html_path = destination / f"{stem}.style.html"
    json_path.write_text(json.dumps(ds, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    html_path.write_text(render_style_report(ds, stem), encoding="utf-8")
    print(f"wrote {json_path} and {html_path} ({len(ds['warnings'])} warnings)")
    return 0
