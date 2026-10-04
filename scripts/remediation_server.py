"""Isolated evaluation API; refuses every database except this audit database."""

import os

from alembic import command
from alembic.config import Config


def main():
    if not os.environ.get("DATABASE_URL", "").endswith("/pharmshift_audit_remediation"):
        raise RuntimeError("The isolated remediation database is required")
    command.upgrade(Config("alembic.ini"), "head")
    from shift_scheduler.db.planning_models import AccountMembership
    from shift_scheduler.db.session import get_session_factory

    with get_session_factory().begin() as session:
        if not session.get(AccountMembership, "remediation-admin"):
            session.add(
                AccountMembership(
                    membership_id="remediation-admin",
                    issuer="mock",
                    subject="admin",
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role="ADMIN",
                    active=True,
                )
            )
    import uvicorn

    uvicorn.run("shift_scheduler.api.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
