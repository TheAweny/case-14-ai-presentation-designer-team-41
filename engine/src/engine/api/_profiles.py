"""Audit profiles from `configs/audit.yaml`, resolved through their `inherits` chain."""

import os
from functools import cache
from pathlib import Path
from typing import Any

import yaml

__all__ = ["UnknownProfileError", "deterministic_profile"]

#: The repository root, four levels above this file: engine/src/engine/api.
_DEFAULT_CONFIG = Path(__file__).resolve().parents[4] / "configs" / "audit.yaml"


class UnknownProfileError(KeyError):
    """The requested audit profile is not in the configuration."""


def _config_path() -> Path:
    return Path(os.environ.get("ENGINE_AUDIT_CONFIG", _DEFAULT_CONFIG))


@cache
def _profiles(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return dict(data.get("profiles") or {})


def deterministic_profile(name: str) -> dict[str, dict[str, Any]]:
    """Settings of the deterministic checks under a profile, with inherited values merged in.

    Without a configuration file only `default` exists, and it means the registry defaults.
    """
    profiles = _profiles(_config_path())
    if name not in profiles:
        if name == "default":
            return {}
        raise UnknownProfileError(name)
    chain: list[dict[str, Any]] = []
    current: str | None = name
    while current is not None:
        if current not in profiles or any(p is profiles[current] for p in chain):
            raise UnknownProfileError(current)
        chain.append(profiles[current])
        current = profiles[current].get("inherits")
    merged: dict[str, dict[str, Any]] = {}
    for profile in reversed(chain):
        for check_id, settings in (profile.get("deterministic") or {}).items():
            merged[check_id] = {**merged.get(check_id, {}), **(settings or {})}
    return merged
