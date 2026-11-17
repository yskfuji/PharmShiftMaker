"""Compatibility storage is development-only, never a second production正本.

This guard is not an authorization mechanism. Operational writers additionally
need scoped authorization, the independent access gate and managed registration.
"""

import os


def require_development_storage() -> None:
    if os.getenv("PHARMSHIFT_ENV") == "production" or os.getenv(
        "PHARMSHIFT_CONTROL_URL"
    ):
        raise RuntimeError(
            "Unregistered legacy storage is disabled; use scoped managed storage"
        )
