from __future__ import annotations

import dataclasses

import pytest

from app.config import Settings, get_settings


def test_defaults_are_safe_without_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("APP_ENVIRONMENT", "APP_REVISION", "API_SIGNING_KEY", "APP_REGION"):
        monkeypatch.delenv(name, raising=False)
    settings = get_settings()
    assert settings.environment == "local"
    assert settings.revision == "dev"
    assert settings.secret_bound is False


def test_environment_overrides_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENVIRONMENT", "production")
    monkeypatch.setenv("APP_REVISION", "9f2c1ab")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    settings = get_settings()
    assert settings.environment == "production"
    assert settings.revision == "9f2c1ab"
    assert settings.metrics_enabled is False


def test_secret_bound_reports_presence_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_SIGNING_KEY", "from-key-vault-csi")
    assert get_settings().secret_bound is True


def test_settings_are_immutable() -> None:
    settings = Settings()
    with pytest.raises(dataclasses.FrozenInstanceError):
        settings.environment = "prod"  # type: ignore[misc]
