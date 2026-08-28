"""Runtime configuration.

Every value is sourced from the environment so the same image can be promoted
unchanged from dev to production. Secrets are never read from files committed to
this repository; in-cluster they arrive as environment variables projected from
the Key Vault CSI driver (see charts/platform-api/templates/secretproviderclass.yaml).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = field(default_factory=lambda: os.getenv("APP_NAME", "platform-api"))
    environment: str = field(default_factory=lambda: os.getenv("APP_ENVIRONMENT", "local"))
    # Injected by the CI/CD pipeline as the image tag (short git SHA).
    revision: str = field(default_factory=lambda: os.getenv("APP_REVISION", "dev"))
    region: str = field(default_factory=lambda: os.getenv("APP_REGION", "unknown"))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper())
    metrics_enabled: bool = field(default_factory=lambda: _flag("METRICS_ENABLED", True))
    # Seconds to keep failing readiness after SIGTERM, so kube-proxy and the
    # ingress controller drop this pod from their endpoint lists before the
    # server stops accepting connections. Must stay below the pod's
    # terminationGracePeriodSeconds (see the Helm chart).
    drain_seconds: float = field(default_factory=lambda: float(os.getenv("DRAIN_SECONDS", "5")))
    # Demonstrates the Key Vault -> CSI -> env var path. Presence only is ever
    # reported; the value itself is never logged or returned by an endpoint.
    api_signing_key: str | None = field(default_factory=lambda: os.getenv("API_SIGNING_KEY"))

    @property
    def secret_bound(self) -> bool:
        return bool(self.api_signing_key)


def get_settings() -> Settings:
    """Build settings from the current environment.

    Deliberately not cached: the test-suite mutates os.environ, and the cost of
    reading a handful of env vars per request is irrelevant next to network I/O.
    """
    return Settings()
