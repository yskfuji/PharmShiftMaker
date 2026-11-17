"""Security utilities for secret management and future auth integrations."""

from .secrets import (
    SecretResolutionError,
    SecretsResolver,
    get_resolver,
    get_secret,
    require_secret,
)

__all__ = [
    "SecretResolutionError",
    "SecretsResolver",
    "get_resolver",
    "get_secret",
    "require_secret",
]
