from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_metrics_exposes_prometheus_exposition(client: TestClient) -> None:
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "http_requests_total" in response.text
    assert "app_build_info" in response.text


def test_requests_are_counted(client: TestClient) -> None:
    client.get("/health")
    body = client.get("/metrics").text
    assert 'http_requests_total{method="GET",path="/health",status="200"}' in body


def test_path_label_uses_route_template_not_raw_url(client: TestClient) -> None:
    # An unmatched path must collapse to a single series, otherwise a scanner
    # hitting random URLs would blow up metric cardinality.
    client.get("/random-1")
    client.get("/random-2")
    body = client.get("/metrics").text
    assert 'path="unmatched"' in body
    assert "random-1" not in body


def test_readiness_gauge_tracks_state(client: TestClient) -> None:
    assert "app_ready 1.0" in client.get("/metrics").text


def test_failed_requests_are_recorded_as_500(settings: Settings) -> None:
    # An unhandled exception must still be counted: the middleware records the
    # outcome before re-raising, otherwise the error rate under-reports exactly
    # when it matters most.
    app = create_app(settings)

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("unhandled")

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/boom").status_code == 500
        body = client.get("/metrics").text

    assert 'http_requests_total{method="GET",path="/boom",status="500"}' in body


def test_metrics_can_be_disabled(settings: Settings) -> None:
    disabled = Settings(**{**settings.__dict__, "metrics_enabled": False})
    with TestClient(create_app(disabled)) as client:
        assert client.get("/metrics").status_code == 404
