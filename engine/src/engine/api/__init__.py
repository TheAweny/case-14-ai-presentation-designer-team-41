"""API layer: the HTTP surface of the engine.

This is the only module allowed to reach into every other layer; the layers themselves stay
independent and are wired together here.
"""

from engine.api.app import app

__all__ = ["app"]
