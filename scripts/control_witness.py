"""Independent witness. Initialization requires an explicitly verified bootstrap digest."""

import argparse
import os
import re

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.witness import Checkpoint, WitnessBase, create_witness


def engine():
    url = make_url(os.environ["PHARMSHIFT_WITNESS_DB_URL"])
    if (
        url.get_backend_name() != "postgresql"
        or not url.database
        or "witness" not in url.database
    ):
        raise ValueError("A separate witness PostgreSQL database is required")
    for key in (
        "DATABASE_URL",
        "SHIFT_SCHEDULER_DB_URL",
        "PHARMSHIFT_AUTHORITY_DB_URL",
    ):
        if os.getenv(key):
            other = make_url(os.environ[key])
            if (other.host, other.port or 5432, other.database) == (
                url.host,
                url.port or 5432,
                url.database,
            ):
                raise ValueError(
                    "Witness must not share an application/control database"
                )
    return create_engine(url, pool_pre_ping=True)


def build_app():
    return create_witness(
        sessionmaker(engine()),
        bytes.fromhex(os.environ["PHARMSHIFT_WITNESS_PRIVATE_KEY"]),
        os.environ["PHARMSHIFT_WITNESS_CLIENT"],
        os.environ["PHARMSHIFT_WITNESS_TOKEN"],
    )


def initialize(digest):
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Verified bootstrap digest required")
    db = engine()
    try:
        WitnessBase.metadata.create_all(db)
        with sessionmaker(db).begin() as session:
            if session.get(Checkpoint, 1):
                raise ValueError("Existing witness cannot be reset or reinitialized")
            session.add(Checkpoint(id=1, sequence=0, digest=digest))
    finally:
        db.dispose()


def upgrade_resolution_schema():
    """Add only the resolution receipt table; never reset the checkpoint or intents."""
    from shift_scheduler.control.witness import IntentResolution

    db = engine()
    try:
        with db.begin() as connection:
            # Requires an existing authority checkpoint; bootstrap uses initialize().
            with sessionmaker(bind=connection)() as session:
                if not session.get(Checkpoint, 1):
                    raise ValueError("Existing checkpoint required")
            IntentResolution.__table__.create(connection, checkfirst=True)
    finally:
        db.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--verified-bootstrap-digest")
    group.add_argument("--upgrade-resolution-schema", action="store_true")
    args = parser.parse_args()
    if args.upgrade_resolution_schema:
        upgrade_resolution_schema()
    else:
        initialize(args.verified_bootstrap_digest)
