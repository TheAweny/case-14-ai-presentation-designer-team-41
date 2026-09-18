"""Deterministic document engine.

The engine owns everything that touches a .pptx file: parsing a template into a profile,
laying out slides, drawing native charts and tables, exporting, rendering and running the
deterministic half of the audit. It never calls a model — that is the TypeScript side's job.
"""

__version__ = "0.1.0"
