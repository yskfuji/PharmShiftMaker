"""Session and engine helpers for the PharmShift database."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .settings import DatabaseSettings

_SessionFactory: sessionmaker[Session] | None = None
_ENGINE: Engine | None = None


def configure_session_factory(
    url: str | None = None, *, echo: bool | None = None
) -> None:
    """Configure (or reconfigure) the global session factory.

    This is primarily useful for tests where an in-memory SQLite database is desired.
    """

    global _SessionFactory, _ENGINE
    settings = DatabaseSettings.from_environment()
    if url is not None:
        settings.url = url
    if echo is not None:
        settings.echo = echo
    engine = create_engine(settings.url, echo=settings.echo, future=True)
    from .restore_lock import protect_engine

    protect_engine(engine)
    _ENGINE = engine
    _SessionFactory = sessionmaker(engine, expire_on_commit=False, autoflush=False)


def get_session_factory() -> sessionmaker[Session]:
    global _SessionFactory
    if _SessionFactory is None:
        configure_session_factory()
    assert _SessionFactory is not None
    return _SessionFactory


def get_engine() -> Engine:
    global _ENGINE
    if _ENGINE is None:
        configure_session_factory()
    assert _ENGINE is not None
    return _ENGINE


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Context manager that yields a Session and ensures proper cleanup."""

    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        raise
    finally:
        session.close()
