from __future__ import annotations

import json
import logging

from app.logging_config import JsonFormatter, configure_logging


def _record(**kwargs: object) -> logging.LogRecord:
    defaults: dict[str, object] = {
        "name": "platform_api",
        "level": logging.INFO,
        "pathname": __file__,
        "lineno": 1,
        "msg": "hello %s",
        "args": ("world",),
        "exc_info": None,
    }
    defaults.update(kwargs)
    return logging.LogRecord(**defaults)  # type: ignore[arg-type]


def test_output_is_json_with_the_expected_fields() -> None:
    payload = json.loads(JsonFormatter().format(_record()))
    assert payload["message"] == "hello world"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "platform_api"
    # Container Insights orders on this; it must always be present.
    assert payload["timestamp"].endswith("+00:00")


def test_context_is_merged_into_the_payload() -> None:
    record = _record()
    record.context = {"environment": "production", "revision": "9f2c1ab"}
    payload = json.loads(JsonFormatter().format(record))
    assert payload["environment"] == "production"
    assert payload["revision"] == "9f2c1ab"


def test_exceptions_are_serialised() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _record(exc_info=sys.exc_info())
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exception"]


def test_configure_logging_replaces_uvicorn_handlers() -> None:
    configure_logging("WARNING")
    root = logging.getLogger()
    assert len(root.handlers) == 1
    assert isinstance(root.handlers[0].formatter, JsonFormatter)
    # uvicorn's own handlers would bypass the JSON formatter entirely.
    access = logging.getLogger("uvicorn.access")
    assert access.handlers == []
    assert access.propagate is True
