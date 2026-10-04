# Type-annotated copy of src/shift_scheduler/control/restore_verification.py for strict mypy.
# The original's bytes are hashed into the restore policy_hash / reconcile
# code_hash, so it must not change. tests/test_type_shadow.py checks that this
# copy has the same logic (annotations, casts and imports removed), the same
# imports in the same scope and order (plus typing-only additions) and the same
# signatures as the .pyi stub, and runs strict mypy on it. Do not reorder imports.
"""Measured restore-target attestations; never a claim of global copy erasure.

Only the authority's preconfigured key/target/domain set can authorize release.
The verifier holds the restore DB lock; normal writers must use protect_engine.
External backups, WAL and physical media are explicitly outside this finite
active-target check. No caller-supplied completeness flag is accepted.
"""
import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from typing import Any
from shift_scheduler.application.hashed_types import TargetDescription
from collections.abc import Mapping

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.db.compliance_models import ManagedCopy, RestoreGate
from shift_scheduler.domain.planning import content_hash

DOMAINS = ('application_database', 'managed_files')


class Attestation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: Literal['registered-restore-target-v1']
    node_id: str
    challenge: str = Field(pattern=r'^[a-f0-9]{32}$')
    generation: int = Field(ge=0)
    manifest_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    target_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    policy_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    domains: tuple[str, ...]
    observation_hashes: dict[str, str]
    registry_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    replay_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    observed_at: datetime
    residual_counts: dict[str, int]
    unobserved_domains: tuple[str, ...]
    all_storage_paths_verified: Literal[False] = False


def policy_hash() -> str:
    from shift_scheduler.application import storage_reconciliation
    return content_hash({'format':'registered-restore-target-v1','domains':DOMAINS,
        'observer':hashlib.sha256(Path(storage_reconciliation.__file__).read_bytes()).hexdigest(),
        'verifier':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})


def target_description(factory: sessionmaker[Session], *, planned_root: str | Path | None = None) -> TargetDescription:
    engine=factory.kw['bind']
    if engine.dialect.name!='postgresql':
        raise ValueError('Restore verification requires real PostgreSQL')
    configured=planned_root or os.environ.get('PHARMSHIFT_MANAGED_STORAGE')
    if not configured:
        raise ValueError('An explicit active managed root is required')
    root=Path(configured)
    if not root.is_absolute() or root.is_symlink() or (planned_root is None and not root.is_dir()):
        raise ValueError('Restore managed root must be an existing absolute non-link directory')
    with engine.connect() as connection:
        db=connection.execute(text('SELECT current_database(),current_schema(),(SELECT oid FROM pg_database WHERE datname=current_database())')).one()
        system=connection.scalar(text('SELECT system_identifier::text FROM pg_control_system()'))
    identity={'host':engine.url.host,'port':engine.url.port or 5432,'database':db[0],
        'schema':db[1],'database_oid':db[2],'system_identifier':system,'managed_root':str(root.resolve())}
    return {'target_hash':content_hash(identity),'policy_hash':policy_hash(),'domains':list(DOMAINS)}


def observe(factory: sessionmaker[Session], manifest_hash: str) -> dict[str, Any]:
    # Standalone CLI must inspect the full supported application schema.
    from shift_scheduler.application.copy_graph import normalized
    from shift_scheduler.application.storage_reconciliation import database_observation, file_observation
    from shift_scheduler.db import models as _legacy_models  # noqa: F401
    with factory() as session:
        gate=session.get(RestoreGate,'restore')
        if not gate or gate.state!='REPLAYED' or gate.marker_manifest_hash!=manifest_hash:
            raise ValueError('Current manifest has not been replayed on this target')
        registry=list(session.scalars(select(ManagedCopy).order_by(ManagedCopy.copy_id)))
        scopes: set[str] | list[str]
        scopes={r.scope_id for r in registry if r.scope_id!='__unclassified__'}
        # Enumerate authoritative rows too. A completely missing registry must
        # not hide another facility by narrowing observation to registered scopes.
        from shift_scheduler.db.base import Base
        for table in Base.metadata.tables.values():
            if 'scope_id' in table.c:
                scopes.update(s for s in session.scalars(select(table.c.scope_id).distinct()) if s and s!='__unclassified__')
        scopes=sorted(scopes)
        if any(r.scope_id=='__unclassified__' for r in registry):
            raise ValueError('Unclassified copy ownership prevents restore release')
        if not scopes:
            # Still check all tables/triggers and unregistered files for an empty
            # registry; an empty caller scope list must never skip observation.
            scopes=['__empty__/__restore__']
        databases={scope:database_observation(session,scope) for scope in scopes}
        files={scope:file_observation(session,scope) for scope in scopes}
        if any(not v['complete'] for v in [*databases.values(),*files.values()]):
            reasons=sorted({issue['reason'] for report in [*databases.values(),*files.values()] for issue in report['issues']})
            raise ValueError('Registered restore target reconciliation incomplete: '+','.join(reasons))
        if any(r.medium not in {'database','file','backup','external'} for r in registry):
            raise ValueError('Unsupported registered storage medium')
        records=[normalized({c.name:getattr(r,c.name) for c in ManagedCopy.__table__.columns}) for r in registry]
        residuals={'external':sum(r.medium=='external' and r.state not in {'ERASED','DELETED'} for r in registry),
            'backup':sum(r.medium=='backup' and r.state not in {'ERASED','DELETED'} for r in registry),
            'retained_control':sum(bool(r.locator.get('retained_control')) for r in registry)}
        return {'observation_hashes':{'application_database':content_hash(databases),'managed_files':content_hash(files)},
            'registry_hash':content_hash(records),'residual_counts':residuals,
            'unobserved_domains':['unregistered_dynamic_paths','external_handoffs','wal_and_physical_media']}


def attest(factory: sessionmaker[Session], node_id: str, current: dict[str, Any], challenge: dict[str, Any],
           replayed: Any, private_key: bytes) -> dict[str, Any]:
    """Measure locally twice; unsigned declarations cannot replace observation."""
    target: Mapping[str, object]=target_description(factory)
    if any(target[k]!=challenge[k] for k in ('target_hash','policy_hash','domains')):
        raise ValueError('Restore target or trusted verifier policy differs')
    first=observe(factory,current['manifest_hash'])
    second=observe(factory,current['manifest_hash'])
    if first!=second:
        raise ValueError('Restore target changed during verification')
    payload=Attestation(format='registered-restore-target-v1',node_id=node_id,
        challenge=challenge['challenge'],generation=current['generation'],manifest_hash=current['manifest_hash'],
        target_hash=target['target_hash'],policy_hash=target['policy_hash'],domains=target['domains'],
        replay_hash=content_hash(replayed),observed_at=datetime.now(UTC),**first).model_dump(mode='json')
    key=Ed25519PrivateKey.from_private_bytes(private_key)
    return {'payload':payload,'signature':key.sign(bytes.fromhex(content_hash(payload))).hex()}
