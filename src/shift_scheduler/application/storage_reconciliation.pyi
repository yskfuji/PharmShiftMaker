# Type stub: the implementation bytes are hashed into the restore policy_hash /
# reconcile code_hash, so annotations live here and the .py stays unchanged.
# Keep in sync with the implementation (checked by mypy.stubtest).
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from shift_scheduler.application.copy_graph import CONTROL as CONTROL
from shift_scheduler.application.copy_graph import LOGICAL as LOGICAL
from shift_scheduler.application.copy_graph import normalized as normalized
from shift_scheduler.application.copy_graph import typed_values as typed_values
from shift_scheduler.application.hashed_types import (
    DatabaseObservation,
    FileObservation,
    Observation,
)
from shift_scheduler.application.subject_references import (
    account_references as account_references,
)
from shift_scheduler.db.base import Base as Base
from shift_scheduler.db.compliance_models import CopySubject as CopySubject
from shift_scheduler.db.compliance_models import ManagedCopy as ManagedCopy
from shift_scheduler.domain.planning import content_hash as content_hash

def _scope_matches(scope: str, value: str | None) -> bool: ...
def database_observation(session: Session, scope: str) -> DatabaseObservation: ...
def _database_observation(session: Session, scope: str) -> DatabaseObservation: ...
def _safe_file_hash(root: str | Path, relative: str) -> str: ...
def file_observation(session: Session, scope: str) -> FileObservation: ...
def _delta(
    before: list[dict[str, Any]], after: list[dict[str, Any]], key: str
) -> dict[str, list[Any]]: ...
def reconcile(
    session: Session, scope: str, previous: Mapping[str, Any] | None = None
) -> Observation: ...
