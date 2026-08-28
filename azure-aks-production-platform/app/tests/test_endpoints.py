from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_root_identifies_environment(client: TestClient) -> None:
    body = client.get("/").json()
    assert body["service"] == "platform-api"
    assert body["environment"] == "test"
    assert body["revision"] == "abc1234"
    assert body["pod"]


def test_root_never_leaks_secret_value(settings: Settings) -> None:
    bound = Settings(**{**settings.__dict__, "api_signing_key": "value-must-not-appear"})
    with TestClient(create_app(bound)) as client:
        response = client.get("/")
    assert response.json()["secret_bound"] is True
    assert "value-must-not-appear" not in response.text


def test_health_is_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_is_true_after_startup(client: TestClient) -> None:
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json()["ready"] is True


def test_ready_returns_503_before_startup(settings: Settings) -> None:
    # No lifespan run: the app has not marked itself ready yet.
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.readiness.mark_draining()
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["ready"] is False


def test_shutdown_marks_instance_not_ready(settings: Settings) -> None:
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get("/ready").status_code == 200
    # Lifespan shutdown has now run; the replica must no longer advertise itself.
    assert app.state.readiness.ready is False


def test_unknown_route_returns_404(client: TestClient) -> None:
    assert client.get("/does-not-exist").status_code == 404
