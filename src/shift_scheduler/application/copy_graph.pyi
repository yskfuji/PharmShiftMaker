# Type stub: the implementation bytes are hashed into the restore policy_hash /
# reconcile code_hash, so annotations live here and the .py stays unchanged.
# Keep in sync with the implementation (checked by mypy.stubtest).
from collections.abc import Collection, Iterator
from typing import Any

from sqlalchemy.orm import Session

from shift_scheduler.db.base import Base as Base
from shift_scheduler.domain.planning import content_hash as content_hash

CONTROL: set[str]
LOGICAL: dict[str, tuple[str, str] | None]

def normalized(value: Any) -> Any: ...
def typed_values(value: Any, names: Collection[str]) -> Iterator[tuple[str, str]]: ...
def logical_target(row: dict[str, Any], key: str) -> tuple[str, str] | None: ...
def database_inventory(session: Session, scope: str, person: str) -> dict[str, Any]: ...
def control_inventory(
    session: Session, scope: str, person: str
) -> list[dict[str, Any]]: ...
