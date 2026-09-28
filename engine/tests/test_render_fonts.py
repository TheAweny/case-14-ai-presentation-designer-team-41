"""I verify which families the renderer can draw, and that require_fonts still rejects the rest."""

import os
import shutil
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

import pytest
from engine.render import missing_fonts, require_fonts
from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "infra/fonts"


@pytest.mark.parametrize("weight", ["Regular", "SemiBold", "Bold"])
def test_inter_bundle_includes_original_static_faces(weight):
    for suffix in [weight, "Italic" if weight == "Regular" else weight + "Italic"]:
        font = ImageFont.truetype(str(FONTS / "Inter" / f"Inter-{suffix}.ttf"), 24)
        family = font.getname()[0]
        assert family is not None and family.startswith("Inter")
        assert font.getlength("Проверка кириллицы") > 0


def test_inter_bundle_carries_redistribution_license():
    license_text = (FONTS / "Inter" / "OFL.txt").read_text()
    assert "SIL OPEN FONT LICENSE" in license_text
    assert "Inter" in license_text


@pytest.mark.skipif(shutil.which("fc-match") is None, reason="Fontconfig is required")
def test_isolated_fontconfig_resolves_inter_and_semibold_without_substitution(
    tmp_path, monkeypatch
):
    config = tmp_path / "fonts.conf"
    config.write_text(
        f"<fontconfig><dir>{escape(str(FONTS.resolve()))}</dir>"
        f"<cachedir>{escape(str(tmp_path / 'cache'))}</cachedir></fontconfig>"
    )
    monkeypatch.setenv("FONTCONFIG_FILE", str(config))
    require_fonts({"Inter", "Inter SemiBold", "Play"})
    result = subprocess.run(
        ["fc-match", "-f", "%{file}", "Inter SemiBold"],
        check=True,
        capture_output=True,
        text=True,
    )
    assert Path(result.stdout).name == "Inter-SemiBold.ttf"


def test_missing_fonts_lists_only_unresolved_families(monkeypatch):
    def run(command, **kwargs):
        family = command[-1]
        stdout = family if family == "Kept" else "Noto Sans"
        return subprocess.CompletedProcess(command, 0, stdout)

    monkeypatch.setattr(subprocess, "run", run)
    assert missing_fonts({"", "Kept", "Absent"}) == ["Absent"]


def test_real_fallback_still_rejects_missing_template_family(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, "Noto Sans"),
    )
    with pytest.raises(ValueError, match="Inter SemiBold"):
        require_fonts({"Inter SemiBold"})


def test_entrypoint_refreshes_mounted_fonts_before_starting_server(tmp_path):
    cache = tmp_path / "fc-cache"
    marker = tmp_path / "cache-refreshed"
    cache.write_text(f'#!/bin/sh\ntouch "{marker}"\n')
    cache.chmod(0o755)
    result = subprocess.run(
        [
            "sh",
            str(ROOT / "infra/docker/engine-entrypoint.sh"),
            "sh",
            "-c",
            f'test -f "{marker}" && printf started',
        ],
        env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"},
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout == "started"


def test_entrypoint_does_not_start_after_font_cache_failure(tmp_path):
    cache = tmp_path / "fc-cache"
    cache.write_text("#!/bin/sh\nexit 7\n")
    cache.chmod(0o755)
    result = subprocess.run(
        ["sh", str(ROOT / "infra/docker/engine-entrypoint.sh"), "printf", "started"],
        env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"},
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 7
    assert not result.stdout
