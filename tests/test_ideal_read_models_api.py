from datetime import datetime
from zoneinfo import ZoneInfo

from tests import test_ideal_workflows_api as base
from tests.test_ideal_workflows_api import OTHER, SCOPE
from tests.test_planning_postgres import pg  # noqa: F401

world = base.world


def test_schedule_calendar_is_department_or_self_only(world):
    period = world["publication"].period_key.split("|", 1)[0][:7]
    admin = world["clients"]["admin"].get(
        "/planning/schedule-calendar" + SCOPE + f"&period={period}"
    )
    assert admin.status_code == 200, admin.text
    department = admin.json()
    assert department["visibility"] == "department"
    assert len(department["assignments"]) == len(world["assignments"])
    assert department["can_export_department"] is True

    pharmacist = world["clients"]["pharmacist"].get(
        "/planning/schedule-calendar" + SCOPE + f"&period={period}"
    )
    assert pharmacist.status_code == 200, pharmacist.text
    personal = pharmacist.json()
    assert personal["visibility"] == "self"
    assert personal["assignments"]
    assert {item["person_id"] for item in personal["assignments"]} == {"p2"}
    assert personal["can_export_department"] is False
    assert (
        world["clients"]["pharmacist"]
        .get("/planning/schedule-calendar" + OTHER)
        .status_code
        == 403
    )


def test_daily_operations_says_scheduled_not_attended(world):
    first = world["assignments"][0]
    day = (
        datetime.fromisoformat(first["start"])
        .astimezone(ZoneInfo("Asia/Tokyo"))
        .date()
        .isoformat()
    )
    response = world["clients"]["leader"].get(
        "/planning/daily-operations" + SCOPE + f"&day={day}"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scheduled_count"] == len(body["scheduled_assignments"])
    assert any("予定上" in item and "実績" in item for item in body["limitations"])
    assert "attended" not in body


def test_stability_is_descriptive_and_not_an_outcome_claim(world):
    response = world["clients"]["pharmacist"].get(
        "/planning/schedule-stability" + SCOPE
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["window_days"] == 14 and len(body["days"]) == 14
    assert "健康" in body["meaning"] and "示しません" in body["meaning"]
