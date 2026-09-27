"""The audit endpoint takes an AuditRequest as JSON and answers with an AuditReport."""

import json
from pathlib import Path

import pytest
from engine.api import app
from engine.api.audit_cli import main
from engine.contracts import AuditReport
from fastapi.testclient import TestClient

_FIXTURES = Path(__file__).resolve().parents[2] / "packages/contracts/fixtures"


def _request() -> dict[str, object]:
    return json.loads((_FIXTURES / "AuditRequest.json").read_text("utf-8"))["valid"][0]["payload"]


def test_audit_answers_with_a_report_that_matches_the_contract() -> None:
    response = TestClient(app).post("/v1/audit", json=_request())
    assert response.status_code == 200
    report = AuditReport.model_validate(response.json())
    assert report.deckId == "deck-1"
    assert report.slideCount == 1
    assert report.profile == "default"


def test_audit_refuses_an_unknown_profile() -> None:
    response = TestClient(app).post("/v1/audit", json={**_request(), "profile": "no-such"})
    assert response.status_code == 422


def test_audit_refuses_slides_that_break_the_contract() -> None:
    payload = _request()
    payload["slides"] = [{"slideId": "s1"}]
    response = TestClient(app).post("/v1/audit", json=payload)
    assert response.status_code == 422


def test_command_prints_the_report_and_exits_by_the_verdict(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "request.json"
    source.write_text(json.dumps(_request()), encoding="utf-8")
    status = main([str(source)])
    report = AuditReport.model_validate_json(capsys.readouterr().out)
    assert status == (0 if report.passed else 1)


def test_command_rejects_an_invalid_request(tmp_path: Path) -> None:
    source = tmp_path / "request.json"
    source.write_text("{}", encoding="utf-8")
    assert main([str(source)]) == 2
