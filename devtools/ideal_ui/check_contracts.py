"""Fail when named OpenAPI response models and checked-in TypeScript drift."""

from __future__ import annotations

import re
from pathlib import Path

from shift_scheduler.api.main import app

ROOT = Path(__file__).resolve().parents[2]
TYPES = ROOT / "frontend/src/ideal/types.ts"
PUBLIC = (
    "PlanningScopeSummary",
    "MembershipRevision",
    "ScheduleChangeCase",
    "LifecycleCase",
    "PersonalScheduleExport",
    "ScopeSettings",
    "AbsenceConsentSetting",
    "ScopeSettingChange",
    "ChangeOptions",
    "ChangeOption",
    "OptionCounterpart",
    "OptionDuty",
    "PlanComparison",
    "PlanFigures",
    "FindingCounts",
    "SolverRecord",
    "PlanPair",
    "AuditTimelinePage",
    "AuditEntry",
    "ScheduleChangeApprovalResult",
    "LifecycleTaskState",
    "PublicationSummary",
    "ScheduleAssignmentChange",
    "ScheduleCalendarView",
    "DailyOperationsSnapshot",
    "StabilityDay",
    "ScheduleStabilitySummary",
    "DashboardMetric",
    "DashboardSource",
    "DashboardSummary",
    "WorkspaceNotification",
)


def typescript_fields(source: str, name: str) -> dict[str, tuple[str, bool]]:
    match = re.search(rf"export interface {name}\s*\{{(.*?)\n\}}", source, re.S)
    if not match:
        raise AssertionError(f"Missing TypeScript interface {name}")
    return {
        field: (type_, optional == "?")
        for field, optional, type_ in re.findall(
            r"^\s{2}([a-z_][a-z0-9_]*)(\?)?:\s*([^;]+);", match.group(1), re.M
        )
    }


def schema_signature(schema: dict[str, object]) -> str:
    if "anyOf" in schema:
        variants = sorted(schema_signature(item) for item in schema["anyOf"])  # type: ignore[index]
        return "|".join(variants)
    if "$ref" in schema:
        # A nested model is named in both; its own fields are checked as a PUBLIC model.
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    if "enum" in schema:
        return "enum:" + "|".join(sorted(str(value) for value in schema["enum"]))  # type: ignore[index]
    kind = schema.get("type")
    if kind == "integer" or kind == "number":
        return "number"
    if kind == "array":
        return f"array<{schema_signature(schema['items'])}>"  # type: ignore[index]
    return str(kind)


def typescript_signature(value: str) -> str:
    value = value.strip()
    if value == "IdealRole":
        return "enum:ADMIN|LEADER|PHARMACIST"
    if value.endswith("[]"):
        return f"array<{typescript_signature(value[:-2])}>"
    if " | " in value:
        quoted = [item.strip() for item in value.split(" | ")]
        literals = [
            item[1:-1] for item in quoted if item.startswith('"') and item.endswith('"')
        ]
        rest = [
            item for item in quoted if not (item.startswith('"') and item.endswith('"'))
        ]
        if literals and all(item == "null" for item in rest):
            enum = "enum:" + "|".join(sorted(literals))
            return "|".join(sorted([enum, *rest]))
        return "|".join(sorted(typescript_signature(item) for item in quoted))
    if value.startswith("Record<string, "):
        return "object"
    return {
        "string": "string",
        "number": "number",
        "boolean": "boolean",
        "null": "null",
    }.get(value, value)


def main() -> None:
    schemas = app.openapi()["components"]["schemas"]
    source = TYPES.read_text(encoding="utf-8")
    failures: list[str] = []
    for name in PUBLIC:
        properties = schemas[name]["properties"]
        api_fields = set(properties)
        ts_fields = typescript_fields(source, name)
        if api_fields != set(ts_fields):
            failures.append(
                f"{name}: api-only={sorted(api_fields-set(ts_fields))} ts-only={sorted(set(ts_fields)-api_fields)}"
            )
            continue
        required = set(schemas[name].get("required", []))
        for field, (ts_type, optional) in ts_fields.items():
            if optional == (field in required):
                failures.append(
                    f"{name}.{field}: OpenAPI required={field in required} TypeScript optional={optional}"
                )
            api_type = schema_signature(properties[field])
            normalized_ts = typescript_signature(ts_type)
            if api_type != normalized_ts:
                failures.append(f"{name}.{field}: api={api_type} ts={normalized_ts}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"OpenAPI ↔ TypeScript: {len(PUBLIC)} public models match")


if __name__ == "__main__":
    main()
