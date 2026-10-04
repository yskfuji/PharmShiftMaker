from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

import pytest

from shift_scheduler.security.secrets import SecretResolutionError, SecretsResolver


def test_env_provider_prefers_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRETS_PROVIDER", "env")
    monkeypatch.setenv("EXAMPLE_SECRET", "hello")
    resolver = SecretsResolver(provider="env")
    assert resolver.get("EXAMPLE_SECRET") == "hello"


def test_aws_provider_uses_injected_client(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {"SecretString": json.dumps({"DATABASE_URL": "postgresql://prod"})}

    class FakeClient:
        def __init__(self) -> None:
            self.calls: int = 0

        def get_secret_value(self, SecretId: str) -> Mapping[str, Any]:
            self.calls += 1
            assert SecretId == "prod/pharmshift"
            return payload

    fake_client = FakeClient()
    monkeypatch.setenv("AWS_SECRETS_MANAGER_SECRET_ID", "prod/pharmshift")
    resolver = SecretsResolver(
        provider="aws", aws_client_factory=lambda: fake_client, cache_seconds=0
    )
    assert resolver.require("DATABASE_URL") == "postgresql://prod"
    assert fake_client.calls == 1


def test_aws_provider_does_not_disclose_secret_identifier(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    resource_locator = "prod/private/pharmshift"

    class FailingClient:
        def get_secret_value(self, SecretId: str) -> Mapping[str, Any]:
            raise RuntimeError(f"backend rejected {SecretId}")

    monkeypatch.setenv("AWS_SECRETS_MANAGER_SECRET_ID", resource_locator)
    resolver = SecretsResolver(
        provider="aws", aws_client_factory=FailingClient, cache_seconds=0
    )
    with caplog.at_level(logging.INFO), pytest.raises(SecretResolutionError) as raised:
        resolver.get("DATABASE_URL")
    assert resource_locator not in str(raised.value)
    assert resource_locator not in caplog.text


def test_vault_provider_supports_kv_v2(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_fetch(url: str, headers: dict[str, str]) -> Mapping[str, Any]:
        assert url.endswith("/v1/kv/data/pharmshift")
        assert headers["X-Vault-Token"] == "token-123"
        return {"data": {"data": {"AUTH_JWT_SECRET": "super-secret"}}}

    monkeypatch.setenv("VAULT_ADDR", "https://vault.internal")
    monkeypatch.setenv("VAULT_TOKEN", "token-123")
    monkeypatch.setenv("VAULT_SECRET_PATH", "kv/data/pharmshift")
    resolver = SecretsResolver(provider="vault", vault_fetcher=fake_fetch)
    assert resolver.require("AUTH_JWT_SECRET") == "super-secret"


def test_require_raises_for_missing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    resolver = SecretsResolver(provider="env")
    with pytest.raises(SecretResolutionError):
        resolver.require("DOES_NOT_EXIST")
