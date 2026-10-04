# Type stub: the implementation bytes are hashed into the restore policy_hash /
# reconcile code_hash, so annotations live here and the .py stays unchanged.
# Keep in sync with the implementation (checked by mypy.stubtest).
from sqlalchemy.orm import Session

from shift_scheduler.application.hashed_types import Coverage, Observation
from shift_scheduler.db.base import Base as Base

def coverage(session: Session | None = None, scope: str | None = None) -> Coverage: ...
def runtime_requirements(observation: Observation | None = None) -> list[str]: ...
def require_schema_coverage() -> Coverage: ...
