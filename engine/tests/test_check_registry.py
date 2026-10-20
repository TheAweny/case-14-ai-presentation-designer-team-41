"""The deterministic check registry stays consistent with configs/audit.yaml."""

import pytest
from engine.checks import DETERMINISTIC_CHECKS, PPTX_CHECKS, check_by_id
from engine.checks.registry import CATEGORIES


def test_check_ids_are_unique() -> None:
    ids = [check.id for check in (*DETERMINISTIC_CHECKS, *PPTX_CHECKS)]
    assert len(ids) == len(set(ids))


def test_every_check_carries_a_description() -> None:
    for check in (*DETERMINISTIC_CHECKS, *PPTX_CHECKS):
        assert check.title
        assert check.description
        assert check.severity in {"blocker", "major", "minor", "info"}
        assert check.category in CATEGORIES


def test_lookup_by_id_reports_unknown_checks() -> None:
    assert check_by_id("contrast").category == "template"
    assert check_by_id("image-text-readability") in PPTX_CHECKS
    with pytest.raises(KeyError):
        check_by_id("no-such-check")


def test_generated_document_includes_file_checks() -> None:
    from lct_tools.audit_docs import render_audit_doc

    document = render_audit_doc()
    for check in PPTX_CHECKS:
        assert f"`{check.id}`" in document
