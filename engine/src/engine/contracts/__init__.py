"""Contracts shared with the TypeScript side.

`_generated.py` is produced from the Zod registry in `packages/contracts` by `yarn codegen`.
The local run protocol uses the generated contracts for template profiles, plans, slide IR,
audit findings, manifests and lifecycle events.
"""

from engine.contracts._generated import (
    AgentConfig,
    ArtifactManifest,
    AuditFinding,
    ContentPack,
    ContractsBundle,
    DeckPlan,
    DesignSystem,
    EditableDeckRequest,
    EditableDeckResponse,
    FixPatch,
    Generation,
    HealthCheck,
    JobEvent,
    LayoutVariant,
    Model,
    PatternCatalog,
    Role,
    RunConfig,
    SlideIR,
    Status,
    TemplateIR,
)
from engine.contracts.provisional import (
    ChartSpec,
    ShapeTree,
    TableSpec,
    TemplateProfile,
    TemplateProfileDraft,
)

__all__ = [
    "AgentConfig",
    "ArtifactManifest",
    "AuditFinding",
    "ChartSpec",
    "ContentPack",
    "ContractsBundle",
    "DeckPlan",
    "DesignSystem",
    "EditableDeckRequest",
    "EditableDeckResponse",
    "FixPatch",
    "Generation",
    "HealthCheck",
    "JobEvent",
    "LayoutVariant",
    "Model",
    "PatternCatalog",
    "Role",
    "RunConfig",
    "ShapeTree",
    "SlideIR",
    "Status",
    "TableSpec",
    "TemplateIR",
    "TemplateProfile",
    "TemplateProfileDraft",
]
