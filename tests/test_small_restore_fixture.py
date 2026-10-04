"""Fixed synthetic fixture review counterexamples."""

from copy import deepcopy
from datetime import UTC, datetime

import pytest
from scripts import small_restore_fixture as m


def rows():
    e = m.expected()
    now = datetime.now(UTC).isoformat()
    return e, {
        "account_memberships": deepcopy(e["memberships"][1]),
        "planning_inputs": {
            "input_hash": e["input_hashes"][1],
            "scope_id": m.SCOPE,
            "input_revision": 2,
            "data_revision": 1,
            "payload": e["inputs"][1],
            "created_by": "fixture",
            "created_at": now,
        },
        "planning_input_heads": {
            "key": m.content_hash(
                [m.SCOPE, "2026-01-05T00:00:00+09:00|2026-01-06T00:00:00+09:00"]
            ),
            "scope_id": m.SCOPE,
            "input_hash": e["input_hashes"][1],
        },
        "planning_outbox": {
            "event_id": "a" * 32,
            "scope_id": m.SCOPE,
            "kind": "retention.rule",
            "actor": "admin",
            "payload": {"key": m.rule_expected("audit")["key"], "revision": 1},
            "created_at": now,
            "delivered_at": None,
        },
    }


def test_known_records_resolve_fixed_people():
    e, r = rows()
    assert m.classify("account_memberships", r["account_memberships"], e) == (
        "restore-operator",
    )
    assert m.classify("planning_inputs", r["planning_inputs"], e) == ("p0", "p1")
    assert m.classify("planning_input_heads", r["planning_input_heads"], e) == (
        "p0",
        "p1",
    )
    assert m.classify("planning_outbox", r["planning_outbox"], e) == (
        "restore-operator",
    )


@pytest.mark.parametrize(
    "fault",
    [
        "unknown_identity",
        "changed_payload",
        "wrong_head",
        "wrong_actor",
        "extra_free_text",
        "unknown_kind",
    ],
)
def test_review_does_not_approve_unknown_shape_or_person(fault):
    e, r = rows()
    if fault == "unknown_identity":
        table = "account_memberships"
        r[table]["person_id"] = "p1"
    elif fault == "changed_payload":
        table = "planning_inputs"
        r[table]["payload"] = deepcopy(r[table]["payload"])
        r[table]["payload"]["people"][0]["name"] = "another person"
    elif fault == "wrong_head":
        table = "planning_input_heads"
        r[table]["input_hash"] = e["input_hashes"][0]
    elif fault == "wrong_actor":
        table = "planning_outbox"
        r[table]["actor"] = "unregistered-system"
    elif fault == "extra_free_text":
        table = "planning_outbox"
        r[table]["payload"]["note"] = "another person mentioned"
    else:
        table = "unknown_joint_body"
    with pytest.raises((ValueError, KeyError)):
        m.classify(table, r.get(table, {}), e)
