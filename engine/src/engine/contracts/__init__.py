"""Contracts shared with the TypeScript side.

`_generated.py` is produced from the Zod schemas in `packages/contracts` by `yarn codegen` and is
committed as is. Aliases for contracts whose Zod schema has not landed yet live in
`provisional.py` and are replaced by generated models one by one.
"""

from engine.contracts._generated import (
    AgentConfig,
    ContractsBundle,
    Generation,
    HealthCheck,
    LayoutVariant,
    Model,
    Role,
    RunConfig,
    Status,
)
from engine.contracts.provisional import (
    AuditFinding,
    ChartSpec,
    DeckPlan,
    ShapeTree,
    SlideIR,
    TableSpec,
    TemplateProfile,
    TemplateProfileDraft,
)

__all__ = [
    "AgentConfig",
    "AuditFinding",
    "ChartSpec",
    "ContractsBundle",
    "DeckPlan",
    "Generation",
    "HealthCheck",
    "LayoutVariant",
    "Model",
    "Role",
    "RunConfig",
    "ShapeTree",
    "SlideIR",
    "Status",
    "TableSpec",
    "TemplateProfile",
    "TemplateProfileDraft",
]
