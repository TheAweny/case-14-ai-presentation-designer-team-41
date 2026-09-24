"""Contracts shared with the TypeScript side.

`_generated.py` is produced from the Zod registry in `packages/contracts` by `yarn codegen`.
The local run protocol uses the generated contracts for template profiles, plans, slide IR,
audit findings, manifests and lifecycle events.
"""

from engine.contracts._generated import (
    AgentConfig,
    ArtifactManifest,
    AuditFinding,
    ContractsBundle,
    DeckPlan,
    EditableDeckRequest,
    EditableDeckResponse,
    Generation,
    HealthCheck,
    LayoutVariant,
    Model,
    Role,
    RunConfig,
    RunEvent,
    SlideIR,
    Status,
    TemplateProfile,
)
from engine.contracts.provisional import ChartSpec, ShapeTree, TableSpec, TemplateProfileDraft

__all__ = [
    "AgentConfig",
    "ArtifactManifest",
    "AuditFinding",
    "ChartSpec",
    "ContractsBundle",
    "DeckPlan",
    "EditableDeckRequest",
    "EditableDeckResponse",
    "Generation",
    "HealthCheck",
    "LayoutVariant",
    "Model",
    "Role",
    "RunConfig",
    "RunEvent",
    "ShapeTree",
    "SlideIR",
    "Status",
    "TableSpec",
    "TemplateProfile",
    "TemplateProfileDraft",
]
