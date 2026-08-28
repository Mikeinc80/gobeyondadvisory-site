from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(
        app_name="platform-api",
        environment="test",
        revision="abc1234",
        region="uksouth",
        log_level="WARNING",
        metrics_enabled=True,
        # No drain wait under test; the drain path itself is covered explicitly
        # in test_endpoints.py::test_shutdown_marks_instance_not_ready.
        drain_seconds=0.0,
        api_signing_key=None,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    # Entering the context manager runs the lifespan, which is what flips
    # readiness - exercising the same code path Kubernetes depends on.
    with TestClient(create_app(settings)) as test_client:
        yield test_client
