"""FastAPI application of the engine."""

import time

from fastapi import FastAPI

from engine import __version__
from engine.contracts import HealthCheck, Status

_STARTED_AT = time.monotonic()

app = FastAPI(
    title="Deck engine",
    version=__version__,
    description=(
        "Deterministic document engine: template parsing, layout, visuals, export, render and "
        "the deterministic audit checks. It never calls a model."
    ),
)


@app.get("/health", response_model=HealthCheck, summary="Liveness of the engine")
def health() -> HealthCheck:
    """Report that the engine process is up, using the shared health contract."""
    return HealthCheck(
        status=Status.ok,
        service="engine",
        version=__version__,
        uptimeSeconds=time.monotonic() - _STARTED_AT,
    )
