"""Visuals layer: native charts, tables and diagrams built from shapes.

Visuals are drawn as native PowerPoint shapes rather than pasted images, so they stay editable
and keep the template's colors and fonts.
"""

from engine.contracts import ChartSpec, ShapeTree, TableSpec, TemplateProfile

__all__ = ["build_chart", "build_table"]


def build_chart(spec: ChartSpec, profile: TemplateProfile) -> ShapeTree:
    """Draw a chart with native shapes, styled from the template profile.

    Args:
        spec: What to plot and how to label it.
        profile: Template profile supplying colors, fonts and spacing.

    Returns:
        The shape tree for the chart.
    """
    raise NotImplementedError


def build_table(spec: TableSpec, profile: TemplateProfile) -> ShapeTree:
    """Draw a table with native shapes, styled from the template profile.

    Args:
        spec: Table contents and column configuration.
        profile: Template profile supplying colors, fonts and spacing.

    Returns:
        The shape tree for the table.
    """
    raise NotImplementedError
