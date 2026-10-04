# Type stub: the implementation bytes are hashed into the restore policy_hash /
# reconcile code_hash, so annotations live here and the .py stays unchanged.
# Keep in sync with the implementation (checked by mypy.stubtest).
from typing import Any

from sqlalchemy.orm import Session

from shift_scheduler.application.hashed_types import AccountReference
from shift_scheduler.db.planning_models import AccountMembership as AccountMembership

ACCOUNT_FIELDS: set[str]

def account_references(
    session: Session, scope: str | None, document: Any
) -> list[AccountReference]: ...
