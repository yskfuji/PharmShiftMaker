"""Secret resolution helpers with Secrets Manager / Vault integration."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

import httpx

logger = logging.getLogger(__name__)

JsonMapping = Mapping[str, Any]
VaultFetcher = Callable[[str, dict[str, str]], Mapping[str, Any]]


class SecretsManagerClient(Protocol):
    def get_secret_value(self, *, SecretId: str) -> Mapping[str, Any]: ...


AwsClientFactory = Callable[[], SecretsManagerClient]


class SecretResolutionError(RuntimeError):
    """Raised when secrets cannot be resolved from the configured provider."""


class _BotoSecretsManagerClient:
    def __init__(self, region: str | None) -> None:
        try:
            import boto3  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:  # pragma: no cover - optional dependency
            raise SecretResolutionError(
                "boto3 is required for AWS secrets provider"
            ) from exc
        boto3_module = cast(Any, boto3)
        boto3_client = cast(Callable[..., Any], boto3_module.client)
        self._client: Any = boto3_client("secretsmanager", region_name=region)

    def get_secret_value(self, *, SecretId: str) -> Mapping[str, Any]:
        response = self._client.get_secret_value(SecretId=SecretId)
        return cast(Mapping[str, Any], response)


@dataclass(slots=True)
class SecretsResolver:
    """Resolve secrets from env, AWS Secrets Manager, or Hashicorp Vault."""

    provider: str = field(default_factory=lambda: os.getenv("SECRETS_PROVIDER", "env"))
    cache_seconds: float = field(
        default_factory=lambda: float(os.getenv("SECRETS_CACHE_SECONDS", "300") or 300)
    )
    aws_client_factory: AwsClientFactory | None = None
    vault_fetcher: VaultFetcher | None = None
    _cache: dict[str, str] | None = field(default=None, init=False, repr=False)
    _cache_expiry: float = field(default=0.0, init=False, repr=False)
    _lock: threading.Lock = field(
        default_factory=threading.Lock, init=False, repr=False
    )

    def __post_init__(self) -> None:
        self.provider = (self.provider or "env").strip().lower()
        if self.cache_seconds < 0:
            self.cache_seconds = 0

    def get(
        self, key: str, *, default: str | None = None, required: bool = False
    ) -> str | None:
        """Return a secret value with fallback to os.environ."""

        value = self._lookup_remote().get(key)
        if value is None:
            value = os.getenv(key, default)
        if value is None and required:
            raise SecretResolutionError(
                f"Secret '{key}' not found via provider '{self.provider}' or environment"
            )
        return value

    def require(self, key: str) -> str:
        value = self.get(key, required=True)
        assert value is not None
        return value

    def snapshot(self) -> dict[str, str]:
        """Return a copy of the cached remote secrets (for diagnostics)."""

        return dict(self._lookup_remote())

    def refresh(self) -> None:
        """Force reload from the remote provider."""

        if self.provider in ("", "env"):
            return
        with self._lock:
            self._cache = self._load_remote()
            self._cache_expiry = time.monotonic() + self.cache_seconds

    def _lookup_remote(self) -> dict[str, str]:
        if self.provider in ("", "env"):
            return {}
        now = time.monotonic()
        with self._lock:
            if (
                self._cache is None
                or now >= self._cache_expiry
                or self.cache_seconds == 0
            ):
                self._cache = self._load_remote()
                if self.cache_seconds > 0:
                    self._cache_expiry = now + self.cache_seconds
                else:
                    self._cache_expiry = now
        return self._cache or {}

    def _load_remote(self) -> dict[str, str]:
        if self.provider == "aws":
            return self._load_from_aws()
        if self.provider == "vault":
            return self._load_from_vault()
        raise SecretResolutionError(f"Unsupported secrets provider '{self.provider}'")

    def _load_from_aws(self) -> dict[str, str]:
        secret_id = os.getenv("AWS_SECRETS_MANAGER_SECRET_ID")
        if not secret_id:
            raise SecretResolutionError(
                "AWS_SECRETS_MANAGER_SECRET_ID must be set for AWS provider"
            )
        region = os.getenv("AWS_REGION")

        client = self._create_aws_client(region)
        logger.info("Fetching secrets from AWS Secrets Manager secret_id=%s", secret_id)
        try:
            response_raw = client.get_secret_value(SecretId=secret_id)
        except Exception as exc:  # noqa: BLE001
            raise SecretResolutionError(
                f"Failed to fetch AWS secret '{secret_id}': {exc}"
            ) from exc

        response = response_raw
        secret_string = response.get("SecretString")
        if not isinstance(secret_string, str) or not secret_string:
            raise SecretResolutionError(
                "AWS secret response did not include SecretString"
            )
        try:
            data = json.loads(secret_string)
        except json.JSONDecodeError as exc:  # pragma: no cover - invalid data
            raise SecretResolutionError(
                "AWS SecretString must be a JSON object"
            ) from exc
        if not isinstance(data, Mapping):
            raise SecretResolutionError("AWS SecretString JSON must be a mapping")
        typed_data = cast(JsonMapping, data)
        return _coerce_to_str_dict(typed_data)

    def _create_aws_client(self, region: str | None) -> SecretsManagerClient:
        if self.aws_client_factory is not None:
            return self.aws_client_factory()
        return _BotoSecretsManagerClient(region)

    def _load_from_vault(self) -> dict[str, str]:
        addr = os.getenv("VAULT_ADDR")
        token = os.getenv("VAULT_TOKEN")
        secret_path = os.getenv("VAULT_SECRET_PATH") or os.getenv("VAULT_KV_PATH")
        if not addr or not token or not secret_path:
            raise SecretResolutionError(
                "VAULT_ADDR, VAULT_TOKEN and VAULT_SECRET_PATH must be set for Vault"
            )
        url = _join_url(addr, f"/v1/{secret_path.lstrip('/')}")
        headers = {"X-Vault-Token": token}
        namespace = os.getenv("VAULT_NAMESPACE")
        if namespace:
            headers["X-Vault-Namespace"] = namespace
        logger.info("Fetching secrets from Vault path=%s", secret_path)
        payload: Mapping[str, Any] = self._fetch_vault_json(url, headers)
        data_raw: Any = payload.get("data") or {}
        if not isinstance(data_raw, Mapping):
            raise SecretResolutionError("Vault response did not contain a data mapping")
        data_mapping = cast(Mapping[str, Any], data_raw)
        nested = data_mapping.get("data")
        if isinstance(nested, Mapping):
            data_mapping = cast(Mapping[str, Any], nested)
        return _coerce_to_str_dict(data_mapping)

    def _fetch_vault_json(self, url: str, headers: dict[str, str]) -> Mapping[str, Any]:
        if self.vault_fetcher is not None:
            return self.vault_fetcher(url, headers)
        timeout = float(os.getenv("VAULT_TIMEOUT_SECONDS", "5") or 5)
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError("Secret provider returned non-object data")
            return cast(Mapping[str, Any], body)


def _join_url(base: str, path: str) -> str:
    if base.endswith("/"):
        base = base[:-1]
    return f"{base}{path}"


def _coerce_to_str_dict(data: Mapping[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in data.items():
        if value is None:
            continue
        result[str(key)] = str(value)
    return result


_default_resolver: SecretsResolver | None = None
_resolver_lock = threading.Lock()


def get_resolver() -> SecretsResolver:
    """Return a module-level singleton resolver."""

    global _default_resolver
    if _default_resolver is None:
        with _resolver_lock:
            if _default_resolver is None:
                _default_resolver = SecretsResolver()
    return _default_resolver


def get_secret(
    key: str, *, default: str | None = None, required: bool = False
) -> str | None:
    return get_resolver().get(key, default=default, required=required)


def require_secret(key: str) -> str:
    return get_resolver().require(key)


__all__ = [
    "SecretResolutionError",
    "SecretsResolver",
    "get_resolver",
    "get_secret",
    "require_secret",
]
