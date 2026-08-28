"""Prometheus instrumentation.

Metric names follow the Prometheus conventions (unit-suffixed, `_total` for
counters) so the same series work in both the Azure Monitor managed Prometheus
workspace and a self-hosted kube-prometheus-stack.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
from starlette.requests import Request
from starlette.responses import Response

# A private registry keeps the exposition surface deterministic and testable
# instead of depending on prometheus_client's process-wide default registry.
REGISTRY = CollectorRegistry()

REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests processed.",
    ["method", "path", "status"],
    registry=REGISTRY,
)

REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency.",
    ["method", "path"],
    # Buckets chosen around the SLO in docs/observability.md (p95 < 250ms).
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
    registry=REGISTRY,
)

APP_INFO = Gauge(
    "app_build_info",
    "Build metadata; always 1, carried by its labels.",
    ["environment", "revision"],
    registry=REGISTRY,
)

READINESS = Gauge(
    "app_ready",
    "1 when the instance is accepting traffic, 0 while draining or starting.",
    registry=REGISTRY,
)


async def metrics_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Record latency and outcome for every request.

    The *route template* is used as the `path` label rather than the raw URL so
    that high-cardinality path segments can never explode the series count.
    """
    started = time.perf_counter()
    try:
        response = await call_next(request)
        status = response.status_code
    except Exception:
        REQUESTS_TOTAL.labels(request.method, _route_of(request), "500").inc()
        REQUEST_DURATION.labels(request.method, _route_of(request)).observe(
            time.perf_counter() - started
        )
        raise

    path = _route_of(request)
    REQUEST_DURATION.labels(request.method, path).observe(time.perf_counter() - started)
    REQUESTS_TOTAL.labels(request.method, path, str(status)).inc()
    return response


def _route_of(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", "unmatched")
