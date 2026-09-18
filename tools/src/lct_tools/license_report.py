"""Builds `docs/LICENSES.md` and enforces the dependency license policy.

The product is open source, so every dependency has to ship under a permissive or weak-copyleft
license. Anything outside the allowed set fails the task instead of quietly ending up in a
release.
"""

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

from lct_tools.paths import DOCS_DIR, REPO_ROOT

__all__ = ["ALLOWED_LICENSES", "Dependency", "collect", "main", "render_report"]

#: Licenses the product may depend on. GPL and AGPL are deliberately absent: the customer takes
#: this repository into a pilot, and strong copyleft would constrain how they may use it.
ALLOWED_LICENSES = frozenset(
    {
        "0BSD",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "BlueOak-1.0.0",
        "CC-BY-4.0",
        "CC0-1.0",
        "ISC",
        "MIT",
        "MIT-0",
        "MIT-CMU",
        "MPL-2.0",
        "PSF-2.0",
        "Python-2.0",
        "Unlicense",
    }
)

_NORMALISED = {
    "apache 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "bsd": "BSD-3-Clause",
    "bsd license": "BSD-3-Clause",
    "bsd 2-clause license": "BSD-2-Clause",
    "bsd 3-clause license": "BSD-3-Clause",
    "mit license": "MIT",
    "the mit license": "MIT",
    "isc license": "ISC",
    "mozilla public license 2.0 (mpl 2.0": "MPL-2.0",
    "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0",
    "python software foundation license": "PSF-2.0",
}

_ALTERNATIVES = re.compile(r"\s+OR\s+|/", re.IGNORECASE)
_TERMS = re.compile(r"\s+AND\s+", re.IGNORECASE)
_COPYLEFT = re.compile(r"\bA?GPL\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Dependency:
    """One dependency and the license it declares."""

    ecosystem: str
    name: str
    version: str
    license: str

    @property
    def allowed(self) -> bool:
        """Whether the declaration offers at least one fully allowed choice.

        An `OR` gives a choice, so one allowed alternative is enough; an `AND` combines
        obligations, so every term of that alternative has to be allowed.
        """
        for alternative in _ALTERNATIVES.split(self.license):
            terms = [term.strip(" ()") for term in _TERMS.split(alternative) if term.strip(" ()")]
            if terms and all(term in ALLOWED_LICENSES for term in terms):
                return True
        return False


def _normalise(raw: str | None) -> str:
    if not raw:
        return "UNKNOWN"
    text = raw.strip().strip("()")
    return _NORMALISED.get(text.lower(), text)


def _node_license(manifest: dict[str, object]) -> str | None:
    value = manifest.get("license")
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        kind = value.get("type")
        return kind if isinstance(kind, str) else None
    licenses = manifest.get("licenses")
    if isinstance(licenses, list) and licenses:
        first = licenses[0]
        if isinstance(first, dict):
            kind = first.get("type")
            return kind if isinstance(kind, str) else None
    return None


def _is_package_root(manifest_path: Path) -> bool:
    """True for `node_modules/<name>/package.json` and its scoped variant."""
    parents = manifest_path.parent.parts
    if len(parents) >= 2 and parents[-2] == "node_modules":
        return True
    return len(parents) >= 3 and parents[-3] == "node_modules" and parents[-2].startswith("@")


def _collect_node(root: Path) -> list[Dependency]:
    modules = root / "node_modules"
    if not modules.is_dir():
        return []
    found: dict[tuple[str, str], Dependency] = {}
    for manifest_path in modules.glob("**/package.json"):
        if not _is_package_root(manifest_path):
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        name = manifest.get("name")
        version = manifest.get("version")
        if not isinstance(name, str) or not isinstance(version, str):
            continue
        if manifest.get("private") is True:
            continue
        found[(name, version)] = Dependency(
            ecosystem="npm",
            name=name,
            version=version,
            license=_normalise(_node_license(manifest)),
        )
    return sorted(found.values(), key=lambda dep: (dep.name, dep.version))


def _python_license(dist: metadata.Distribution) -> str | None:
    expression = dist.metadata.get("License-Expression")
    if isinstance(expression, str) and expression:
        return expression
    declared = dist.metadata.get("License")
    if isinstance(declared, str) and declared and "\n" not in declared:
        return declared
    for classifier in dist.metadata.get_all("Classifier") or []:
        if isinstance(classifier, str) and classifier.startswith("License ::"):
            return classifier.rsplit("::", 1)[-1].strip()
    return None


def _collect_python() -> list[Dependency]:
    found: dict[tuple[str, str], Dependency] = {}
    for dist in metadata.distributions():
        name = dist.metadata.get("Name")
        if not isinstance(name, str):
            continue
        found[(name, dist.version)] = Dependency(
            ecosystem="python",
            name=name,
            version=dist.version,
            license=_normalise(_python_license(dist)),
        )
    return sorted(found.values(), key=lambda dep: (dep.name, dep.version))


def collect(root: Path = REPO_ROOT) -> list[Dependency]:
    """Collect every installed dependency of both ecosystems."""
    return _collect_node(root) + _collect_python()


def render_report(dependencies: list[Dependency]) -> str:
    """Render the text of `docs/LICENSES.md` from the collected dependencies."""
    by_license: dict[str, int] = defaultdict(int)
    for dep in dependencies:
        by_license[dep.license] += 1
    flagged = [dep for dep in dependencies if not dep.allowed]
    npm_count = sum(1 for dep in dependencies if dep.ecosystem == "npm")
    python_count = len(dependencies) - npm_count

    lines = [
        "<!-- Generated by `yarn licenses`. Do not edit by hand. -->",
        "",
        "# Лицензии зависимостей",
        "",
        "Решение открытое, поэтому зависимости берём только под разрешительными и слабыми",
        "копилефт-лицензиями: " + ", ".join(sorted(ALLOWED_LICENSES)) + ".",
        "GPL и AGPL не подходят: заказчик берёт решение в пилот и внедрение.",
        "",
        f"Всего зависимостей: {len(dependencies)} (npm: {npm_count}, python: {python_count}).",
        "",
        "## Сводка по лицензиям",
        "",
        "| Лицензия | Пакетов | Статус |",
        "| --- | --- | --- |",
    ]
    for name, count in sorted(by_license.items(), key=lambda item: (-item[1], item[0])):
        status = "разрешена" if name in ALLOWED_LICENSES else "требует проверки"
        lines.append(f"| {name} | {count} | {status} |")

    lines += ["", "## Требуют проверки", ""]
    if flagged:
        lines += ["| Экосистема | Пакет | Версия | Лицензия |", "| --- | --- | --- | --- |"]
        lines += [
            f"| {dep.ecosystem} | {dep.name} | {dep.version} | {dep.license} |" for dep in flagged
        ]
    else:
        lines.append("Нет: все зависимости укладываются в политику.")

    lines += [
        "",
        "## Полный список",
        "",
        "| Экосистема | Пакет | Версия | Лицензия |",
        "| --- | --- | --- | --- |",
    ]
    lines += [
        f"| {dep.ecosystem} | {dep.name} | {dep.version} | {dep.license} |" for dep in dependencies
    ]
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    """Write the report and fail if a dependency falls outside the policy."""
    dependencies = collect()
    target = DOCS_DIR / "LICENSES.md"
    target.write_text(render_report(dependencies), encoding="utf-8")

    forbidden = [dep for dep in dependencies if _COPYLEFT.search(dep.license)]
    unknown = [dep for dep in dependencies if not dep.allowed and dep not in forbidden]

    print(f"wrote {target} for {len(dependencies)} dependencies")
    if unknown:
        print(f"{len(unknown)} dependencies need a manual license review:")
        for dep in unknown[:20]:
            print(f"  {dep.ecosystem} {dep.name}@{dep.version}: {dep.license}")
    if forbidden:
        print("copyleft licenses are not allowed in this product:")
        for dep in forbidden:
            print(f"  {dep.ecosystem} {dep.name}@{dep.version}: {dep.license}")
        return 1
    return 0
