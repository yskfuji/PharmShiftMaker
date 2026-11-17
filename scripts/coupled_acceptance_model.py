"""Independent bounded acceptance model; no application imports.

The finite domain is intentionally explicit. Exploration success is distinct
from real-API replay success. Historical/legal control residuals are not erased
by declaring operational copies absent.
"""

import hashlib
import json
from dataclasses import asdict, dataclass, replace

SPEC = {
    "schema_version": 1,
    "persons": ["p0", "p1"],
    "departments": ["a", "b"],
    "months": ["2026-02", "2026-03"],
    "grant_lots": ["lot-p0", "lot-p1"],
    "grant_days": [2, 2],
    "publication_versions": [1, 2],
    "copy_versions": [1, 2],
    "copy_ownership": ["p0", "p1", "shared"],
    "clock_boundaries": ["before_backup_expiry", "after_backup_expiry"],
    "abstraction": "Two known typed copy versions per owner; immutable control residual retained. Restore models latest erasure-overlay gate, not physical restore correctness.",
    "outside_model": [
        "arbitrary_free_text",
        "unbounded_revisions",
        "network_fault_interleavings",
        "physical_database_restore",
    ],
    "full_task_acceptance_requires": [
        "all_model_edges_api_replayed",
        "all_shared_types_adapter",
        "25_month_scenario",
        "physical_restore_and_fault_suite",
    ],
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


@dataclass(frozen=True)
class State:
    publications: tuple = (0, 0, 0, 0)  # person-major, then month
    consumed: int = 0
    holds: tuple = (0, 0)  # 0 never set, 1 active, 2 released (two versions)
    erased: int = 0
    backup_present: int = 3  # two independently expiring backup versions
    restore_phase: int = 0  # open / quarantined / applied
    applied_generation: int = -1

    def json(self):
        return asdict(self)

    @classmethod
    def parse(cls, value):
        return cls(
            **{
                **value,
                "publications": tuple(value["publications"]),
                "holds": tuple(value["holds"]),
            }
        )


def actions():
    result = []
    for p in range(2):
        for m in range(2):
            for version in (1, 2):
                for variant in ("normal", "wrong_department", "stale_approval"):
                    result.append(
                        {
                            "op": "publish",
                            "person": p,
                            "month": m,
                            "version": version,
                            "variant": variant,
                        }
                    )
            result.append({"op": "consume", "person": p, "month": m})
            result.append({"op": "duplicate_consume", "person": p, "month": m})
        result.extend(
            [
                {"op": "hold", "person": p, "active": True},
                {"op": "hold", "person": p, "active": False},
                {"op": "erase", "person": p},
            ]
        )
    for version in (1, 2):
        result.extend(
            [
                {"op": "expire_backup", "version": version},
                {"op": "restore_begin", "version": version},
            ]
        )
    for variant in ("latest", "stale"):
        result.extend(
            [
                {"op": "restore_apply", "variant": variant},
                {"op": "restore_open", "variant": variant},
            ]
        )
    return tuple(result)


def observation(state):
    lots = []
    for p in range(2):
        consumed = sum(bool(state.consumed & (1 << (p * 2 + m))) for m in range(2))
        reserved = sum(
            state.publications[p * 2 + m] > 0
            and not state.consumed & (1 << (p * 2 + m))
            for m in range(2)
        )
        lots.append(
            {
                "lot": "lot-p" + str(p),
                "available": 2 - consumed - reserved,
                "reserved": reserved,
                "consumed": consumed,
            }
        )
    live_mask = 3 & ~state.erased
    copies = [
        {
            "owner": owner,
            "version": version,
            "subjects": mask & live_mask,
            "partial": bool(mask & state.erased) and bool(mask & live_mask),
        }
        for owner, mask in [("p0", 1), ("p1", 2), ("shared", 3)]
        for version in (1, 2)
    ]
    return {
        "publication_versions": list(state.publications),
        "lots": lots,
        "operational_copies": copies,
        "retained_backups": [
            v for v in (1, 2) if state.backup_present & (1 << (v - 1))
        ],
        "retained_erasure_controls": [p for p in (0, 1) if state.erased & (1 << p)],
        "access_open": state.restore_phase == 0,
        "control_generation": state.erased.bit_count(),
        "all_copies_erased": False,
    }


def transition(state, action):
    """Return expected semantic state plus allowed/rejected reason, independently."""
    op = action["op"]
    p = action.get("person", 0)
    bit = 1 << p

    def answer(new=state, accepted=False, reason="rejected"):
        return new, {
            "accepted": accepted,
            "reason": reason,
            "observation": observation(new),
        }

    if state.restore_phase and not op.startswith("restore_"):
        return answer(reason="restore_quarantine")
    if op == "publish":
        i = p * 2 + action["month"]
        current = state.publications[i]
        version = action["version"]
        if action["variant"] == "wrong_department":
            return answer(reason="scope_denied")
        if state.erased & bit:
            return answer(reason="erased_subject_recreation")
        if action["variant"] == "stale_approval":
            return answer(reason="approval_changed")
        if version <= current:
            return answer(accepted=True, reason="idempotent_publication")
        if version != current + 1:
            return answer(reason="publication_version_conflict")
        if current and state.consumed & (1 << i):
            return answer(reason="settled_leave_requires_reconciliation")
        values = list(state.publications)
        values[i] = version
        return answer(replace(state, publications=tuple(values)), True, "published")
    if op in ("consume", "duplicate_consume"):
        i = p * 2 + action["month"]
        if state.erased & bit:
            return answer(reason="erased_subject_recreation")
        if not state.publications[i]:
            return answer(reason="no_publication_reservation")
        if op == "duplicate_consume":
            return answer(
                accepted=bool(state.consumed & (1 << i)),
                reason=(
                    "idempotent_settlement"
                    if state.consumed & (1 << i)
                    else "unknown_settlement"
                ),
            )
        if state.consumed & (1 << i):
            return answer(reason="no_reserved_balance")
        return answer(
            replace(state, consumed=state.consumed | (1 << i)), True, "consumed"
        )
    if op == "hold":
        target = 1 if action["active"] else 2
        if target == state.holds[p]:
            return answer(accepted=True, reason="idempotent_hold")
        if target != state.holds[p] + 1:
            return answer(reason="hold_version_conflict")
        values = list(state.holds)
        values[p] = target
        return answer(replace(state, holds=tuple(values)), True, "hold_updated")
    if op == "erase":
        if state.holds[p] == 1:
            return answer(reason="active_hold")
        if state.erased & bit:
            return answer(accepted=True, reason="idempotent_erasure")
        return answer(
            replace(state, erased=state.erased | bit),
            True,
            "operational_erasure_with_control_residual",
        )
    if op == "expire_backup":
        return answer(
            replace(
                state,
                backup_present=state.backup_present & ~(1 << (action["version"] - 1)),
            ),
            True,
            "backup_expired_at_fixed_boundary",
        )
    if op == "restore_begin":
        if state.restore_phase:
            return answer(reason="restore_already_started")
        if not state.backup_present & (1 << (action["version"] - 1)):
            return answer(reason="backup_absent")
        return answer(
            replace(state, restore_phase=1, applied_generation=-1),
            True,
            "quarantined_before_restore",
        )
    if op == "restore_apply":
        if state.restore_phase != 1:
            return answer(reason="restore_not_quarantined")
        if action["variant"] == "stale":
            return answer(reason="stale_control_generation")
        return answer(
            replace(
                state, restore_phase=2, applied_generation=state.erased.bit_count()
            ),
            True,
            "latest_controls_applied",
        )
    if op == "restore_open":
        if state.restore_phase != 2:
            return answer(reason="restore_not_verified")
        if (
            action["variant"] == "stale"
            or state.applied_generation != state.erased.bit_count()
        ):
            return answer(reason="stale_control_generation")
        return answer(
            replace(state, restore_phase=0, applied_generation=-1), True, "gate_opened"
        )
    raise ValueError("Unknown model operation")
