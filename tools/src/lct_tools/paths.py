"""Locations inside the repository, resolved from this file."""

from pathlib import Path

__all__ = ["CONFIGS_DIR", "CONTEXTUAL_CHECKS_FILE", "DOCS_DIR", "REPO_ROOT"]

REPO_ROOT = Path(__file__).resolve().parents[3]
CONFIGS_DIR = REPO_ROOT / "configs"
DOCS_DIR = REPO_ROOT / "docs"
CONTEXTUAL_CHECKS_FILE = (
    REPO_ROOT / "packages" / "pipeline" / "src" / "audit" / "contextual-checks.json"
)
