# syntax=docker/dockerfile:1.7
#
# Multi-stage build. The builder compiles wheels into a virtualenv; the runtime
# stage copies only that virtualenv, so no compiler, pip cache or build headers
# reach production. Digest-pinning the base images is the next hardening step
# and is called out in docs/security.md.

FROM python:3.12-slim-bookworm AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Dependencies are copied and installed before application code so that code
# changes do not invalidate the (slow) dependency layer.
COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt


FROM python:3.12-slim-bookworm AS runtime

# A fixed, high UID that does not collide with anything in the base image and
# satisfies runAsNonRoot without relying on the image's default user.
ARG APP_UID=10001
ARG APP_GID=10001

# Build metadata surfaced by /: set by CI from the git SHA.
ARG APP_REVISION=dev
ENV APP_REVISION=${APP_REVISION} \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Patch the base image, then drop apt entirely from the final layer set.
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid ${APP_GID} app \
    && useradd --uid ${APP_UID} --gid ${APP_GID} --no-create-home --shell /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /srv
COPY --chown=${APP_UID}:${APP_GID} app ./app

USER ${APP_UID}:${APP_GID}
EXPOSE 8000

# No HEALTHCHECK: Kubernetes owns liveness/readiness via the probes defined in
# the Helm chart, and a second, differently-configured check only adds
# ambiguity about which one failed.

# Single worker per container: scaling is the HPA's job, which keeps the
# CPU-per-replica signal meaningful and the pods small enough to reschedule fast.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
