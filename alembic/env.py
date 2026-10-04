"""Alembic environment configuration for PharmShift."""

from __future__ import annotations

import os
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import engine_from_config, pool

from shift_scheduler.db.base import Base
from shift_scheduler.db import models  # noqa: F401 - ensure models are imported
from shift_scheduler.db.settings import DatabaseSettings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _database_url() -> str:
    settings = DatabaseSettings.from_environment()
    return settings.url


def _should_render_as_batch(url: str) -> bool:
    return url.startswith("sqlite")


def run_migrations_offline() -> None:
    url = _database_url()
    config.set_main_option("sqlalchemy.url", url)
    context.configure(
        url=url,
        target_metadata=Base.metadata,
        literal_binds=True,
        render_as_batch=_should_render_as_batch(url),
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _database_url()
    config_section: dict[str, Any] = dict(config.get_section(config.config_ini_section) or {})
    config_section["sqlalchemy.url"] = url

    connectable = engine_from_config(
        config_section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=_should_render_as_batch(url),
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
