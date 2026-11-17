"""Run with uvicorn scripts.control_authority:build_app --factory; separate DB only."""

import json
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.service import ControlBase, Head, create_app


def initialize(url):
    engine = independent_engine(url)
    ControlBase.metadata.create_all(engine)
    with sessionmaker(engine).begin() as session:
        if not session.get(Head, 1):
            session.add(Head(id=1, generation=0))
    engine.dispose()


def independent_engine(url):
    from sqlalchemy.engine import make_url

    parsed = make_url(url)
    if (
        parsed.get_backend_name() != "postgresql"
        or not parsed.database
        or "control" not in parsed.database
    ):
        raise ValueError("A separate PostgreSQL control database is required")
    for key in ("DATABASE_URL", "SHIFT_SCHEDULER_DB_URL"):
        if os.getenv(key):
            other = make_url(os.environ[key])
            if (other.host, other.port or 5432, other.database) == (
                parsed.host,
                parsed.port or 5432,
                parsed.database,
            ):
                raise ValueError(
                    "Authority cannot share the application database, even with different credentials"
                )
    return create_engine(url, pool_pre_ping=True)


def build_app():
    from shift_scheduler.control.client import AuthorityClient

    witness = None
    if os.getenv("PHARMSHIFT_WITNESS_URL"):
        witness = AuthorityClient(
            os.environ["PHARMSHIFT_WITNESS_URL"],
            os.environ["PHARMSHIFT_WITNESS_CLIENT"],
            os.environ["PHARMSHIFT_WITNESS_TOKEN"],
            os.environ["PHARMSHIFT_WITNESS_PUBLIC_KEY"],
        )
    observer = None
    if os.getenv("PHARMSHIFT_DIAGNOSTIC_CONTROL_TIMING") == "1":
        if os.getenv("PHARMSHIFT_ENV") != "development":
            raise ValueError(
                "Explicit control timing output is restricted to development"
            )

        def observer(record):
            # The witness emits aggregate durations/outcome only, never payloads.
            safe = {
                key: record[key]
                for key in ("event", "outcome", "total_seconds", "stages")
            }
            print(json.dumps(safe, sort_keys=True), flush=True)

    factory = sessionmaker(
        independent_engine(os.environ["PHARMSHIFT_AUTHORITY_DB_URL"])
    )
    return create_app(
        factory,
        bytes.fromhex(os.environ["PHARMSHIFT_AUTHORITY_PRIVATE_KEY"]),
        json.loads(os.environ["PHARMSHIFT_AUTHORITY_CREDENTIALS"]),
        witness=witness,
        timing_observer=observer,
        restore_verifiers=json.loads(os.getenv("PHARMSHIFT_RESTORE_VERIFIERS", "{}")),
    )


if __name__ == "__main__":
    initialize(os.environ["PHARMSHIFT_AUTHORITY_DB_URL"])
