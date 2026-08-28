"""platform-api - the workload used to exercise the platform.

The service is intentionally small. Its job is to prove out the parts of the
platform that are hard to demonstrate without a real workload: probes, graceful
shutdown, Prometheus scraping, Key Vault-backed configuration and per-environment
identity.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from .config import Settings, get_settings
from .logging_config import configure_logging
from .metrics import APP_INFO, READINESS, REGISTRY, metrics_middleware

logger = logging.getLogger("platform_api")


class ReadinessState:
    """Tracks whether this replica should receive traffic.

    Liveness and readiness answer different questions: liveness means "the
    process is not wedged", readiness means "send me requests". Conflating them
    causes Kubernetes to restart pods that are merely draining.
    """

    def __init__(self) -> None:
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    def mark_ready(self) -> None:
        self._ready = True
        READINESS.set(1)

    def mark_draining(self) -> None:
        self._ready = False
        READINESS.set(0)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    configure_logging(settings.log_level)
    APP_INFO.labels(settings.environment, settings.revision).set(1)

    # Real services warm caches or open pools here; the point is that readiness
    # flips only once that work has finished.
    app.state.readiness.mark_ready()
    logger.info(
        "startup complete",
        extra={"context": {"environment": settings.environment, "revision": settings.revision}},
    )

    yield

    # Shutdown: stop advertising readiness, then linger so in-flight requests
    # and endpoint propagation can complete.
    app.state.readiness.mark_draining()
    logger.info("draining", extra={"context": {"drain_seconds": settings.drain_seconds}})
    if settings.drain_seconds > 0:
        await asyncio.sleep(settings.drain_seconds)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title="platform-api",
        version=settings.revision,
        summary="Reference workload for the azure-aks-production-platform project.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.readiness = ReadinessState()
    app.middleware("http")(metrics_middleware)

    @app.get("/", tags=["info"])
    async def root() -> dict[str, object]:
        """Identify the environment serving this request.

        Used to prove that a promotion actually changed what is running: the
        revision here is the image tag pushed by the CD workflow.
        """
        return {
            "service": settings.app_name,
            "environment": settings.environment,
            "revision": settings.revision,
            "region": settings.region,
            "pod": socket.gethostname(),
            # Presence, never the value - the secret itself must not leave the pod.
            "secret_bound": settings.secret_bound,
        }

    @app.get("/health", tags=["probes"])
    async def health() -> dict[str, str]:
        """Liveness: the event loop is running and can serve a response."""
        return {"status": "ok"}

    @app.get("/ready", tags=["probes"])
    async def ready(response: Response) -> dict[str, object]:
        """Readiness: this replica wants traffic.

        Returns 503 while starting or draining so that the Service removes the
        pod from its endpoints instead of black-holing requests.
        """
        is_ready = app.state.readiness.ready
        if not is_ready:
            response.status_code = 503
        return {"ready": is_ready, "environment": settings.environment}

    @app.get("/metrics", tags=["observability"], include_in_schema=False)
    async def metrics() -> Response:
        if not settings.metrics_enabled:
            return Response(status_code=404)
        return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()
