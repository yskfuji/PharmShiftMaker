from shift_scheduler.application.copy_graph import logical_target


def test_overloaded_case_ids_are_resolved_by_outbox_contract() -> None:
    assert logical_target(
        {"table": "planning_outbox", "payload": {"kind": "privacy.decision"}}, "case_id"
    ) == ("privacy_cases", "case_id")
    assert logical_target(
        {"table": "planning_outbox", "payload": {"kind": "change.approved"}}, "case_id"
    ) == ("planning_change_cases", "case_id")
    assert logical_target(
        {"table": "planning_outbox", "payload": {"kind": "lifecycle.task.completed"}},
        "case_id",
    ) == ("staff_lifecycle_cases", "case_id")


def test_physical_workflow_event_case_ids_do_not_gain_a_privacy_edge() -> None:
    assert (
        logical_target(
            {"table": "planning_change_events", "payload": {"kind": "APPROVED"}},
            "case_id",
        )
        is None
    )
