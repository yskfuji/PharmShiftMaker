"""No existing API operation disappears or is renamed: the OpenAPI operations recorded on
2026-09-30 (before the ideal UI mutations) must remain a subset of the current ones."""

import json
from pathlib import Path

from shift_scheduler.api.main import app

RECORDED = Path(__file__).parent / "fixtures" / "openapi" / "operations-2026-09-30.json"


def current_operations() -> set[str]:
    return {
        f"{method.upper()} {path}"
        for path, item in app.openapi()["paths"].items()
        for method in item
        if method in ("get", "post", "put", "patch", "delete")
    }


def test_recorded_operations_are_still_served():
    missing = set(json.loads(RECORDED.read_text())) - current_operations()
    assert not missing, sorted(missing)
