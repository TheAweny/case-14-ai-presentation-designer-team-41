"""I join brand application and profile extraction at the engine's layer boundary."""

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from engine.contracts._generated import CompositionExportRequest
from engine.export.brandbook import apply_brandbook


@contextmanager
def effective_composition_request(
    request: CompositionExportRequest,
) -> Iterator[CompositionExportRequest]:
    """I use one physically branded source for fit, native export and deterministic audit."""
    with tempfile.TemporaryDirectory(prefix="brandbook-effective-") as directory:
        source = Path(request.templatePath).resolve()
        if not source.is_file():
            raise FileNotFoundError("Template not found.")
        target = Path(directory) / "template.pptx"
        binding = request.brandbook
        if binding is None:
            yield request
            return
        apply_brandbook(source, target, binding.model_dump(mode="json"))
        yield request.model_copy(update={"templatePath": str(target), "brandbook": None})
