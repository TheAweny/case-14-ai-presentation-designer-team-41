"""The engine answers /health and describes itself in OpenAPI."""

from engine.api import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_health_reports_the_engine_is_up() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "engine"
    assert payload["uptimeSeconds"] >= 0


def test_openapi_document_is_served() -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "/health" in response.json()["paths"]
