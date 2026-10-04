# Type stub: the implementation bytes are hashed into the restore policy_hash /
# reconcile code_hash, so annotations live here and the .py stays unchanged.
# Keep in sync with the implementation (checked by mypy.stubtest).
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.application.hashed_types import TargetDescription
from shift_scheduler.db.compliance_models import ManagedCopy as ManagedCopy
from shift_scheduler.db.compliance_models import RestoreGate as RestoreGate
from shift_scheduler.domain.planning import content_hash as content_hash

DOMAINS: tuple[str, ...]

class Attestation(BaseModel):
    model_config: ClassVar[ConfigDict]
    format: Literal["registered-restore-target-v1"]
    node_id: str
    challenge: str
    generation: int
    manifest_hash: str
    target_hash: str
    policy_hash: str
    domains: tuple[str, ...]
    observation_hashes: dict[str, str]
    registry_hash: str
    replay_hash: str
    observed_at: datetime
    residual_counts: dict[str, int]
    unobserved_domains: tuple[str, ...]
    all_storage_paths_verified: Literal[False] = False

def policy_hash() -> str: ...
def target_description(
    factory: sessionmaker[Session], *, planned_root: str | Path | None = None
) -> TargetDescription: ...
def observe(factory: sessionmaker[Session], manifest_hash: str) -> dict[str, Any]: ...
def attest(
    factory: sessionmaker[Session],
    node_id: str,
    current: dict[str, Any],
    challenge: dict[str, Any],
    replayed: Any,
    private_key: bytes,
) -> dict[str, Any]: ...
