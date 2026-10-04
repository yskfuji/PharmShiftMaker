"""Boundary controls for the disposable planning E2E server."""

import pytest
from scripts.planning_test_server import _port


@pytest.mark.parametrize("value", ["1", "18500", "65535"])
def test_port_accepts_canonical_decimal(monkeypatch, value):
    monkeypatch.setenv("TEST_E2E_PORT", value)
    assert _port("TEST_E2E_PORT", 18500) == int(value)


@pytest.mark.parametrize(
    "value",
    ["0", "65536", "18500abc", "2.5", "+18500", " 18500", "018500"],
)
def test_port_rejects_noncanonical_or_out_of_range_values(monkeypatch, value):
    monkeypatch.setenv("TEST_E2E_PORT", value)
    with pytest.raises(ValueError, match="integer between 1 and 65535"):
        _port("TEST_E2E_PORT", 18500)
