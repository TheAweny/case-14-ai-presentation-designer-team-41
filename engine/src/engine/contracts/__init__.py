"""Contracts shared with the TypeScript side.

`_generated.py` is produced from the Zod schemas in `packages/contracts` by `yarn codegen` and is
committed as is. Aliases for contracts whose Zod schema has not landed yet live in
`provisional.py` and are replaced by generated models one by one.
"""

from engine.contracts._generated import (
    AgentConfig,
    ArtifactManifest,
    AuditFinding,
    ContentPack,
    ContractsBundle,
    DeckPlan,
    DesignSystem,
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
