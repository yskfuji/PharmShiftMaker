"""Deployment profiles.

``production`` is the multi-user server deployment (OIDC, independent witness).
``desktop`` is the single-PC trial deployment packaged with the desktop shell
(local accounts, loopback only). Both are *hardened*: every safety check that
protects personal data in production also applies to the desktop profile.
"""

from __future__ import annotations

import os

PRODUCTION = "production"
DESKTOP = "desktop"


def environment() -> str:
    return os.getenv("PHARMSHIFT_ENV", "development")


def is_production() -> bool:
    return environment() == PRODUCTION


def is_desktop() -> bool:
    return environment() == DESKTOP


def is_hardened() -> bool:
    """Production or desktop: no development fallbacks are allowed."""
    return environment() in {PRODUCTION, DESKTOP}


__all__ = [
    "DESKTOP",
    "PRODUCTION",
    "environment",
    "is_desktop",
    "is_hardened",
    "is_production",
]
