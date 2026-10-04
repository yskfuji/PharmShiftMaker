"""PostgreSQL restore excludes application transactions before the first restored byte."""

from sqlalchemy import event, text
from sqlalchemy.engine import Connection, Engine


class RestoreUnavailable(RuntimeError):
    pass


RESTORE_LOCK = 684826410238117


def protect_engine(engine: Engine) -> None:
    @event.listens_for(engine, "begin")
    def check_restore(connection: Connection) -> None:
        from shift_scheduler.control.client import require_access

        require_access()
        if engine.dialect.name != "postgresql":
            return
        allowed = connection.scalar(
            text("SELECT pg_try_advisory_xact_lock_shared(:key)"), {"key": RESTORE_LOCK}
        )
        if not allowed:
            raise RestoreUnavailable(
                "Database is isolated for restore; retry after verified recovery"
            )
        control = connection.scalar(
            text("SELECT to_regclass('pharmshift_restore_control.gate')")
        )
        if control and connection.scalar(
            text(
                "SELECT count(*) FROM pharmshift_restore_control.gate WHERE state <> 'REPLAYED'"
            )
        ):
            raise RestoreUnavailable("Independent restore gate remains quarantined")
        exists = connection.scalar(text("SELECT to_regclass('restore_gates')"))
        if exists and connection.scalar(
            text("SELECT count(*) FROM restore_gates WHERE state <> 'REPLAYED'")
        ):
            raise RestoreUnavailable("Restored database remains quarantined")
