from devtools.er.ia_map import _match, match_observed
from devtools.er.physical import database_tables, mermaid
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    UniqueConstraint,
    create_engine,
)


def test_optional_required_and_unique_fk_from_real_constraints():
    metadata = MetaData()
    Table("parent", metadata, Column("id", Integer, primary_key=True))
    Table(
        "optional",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", ForeignKey("parent.id"), nullable=True),
    )
    Table(
        "required",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", ForeignKey("parent.id"), nullable=False),
    )
    Table(
        "unique_child",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", ForeignKey("parent.id"), nullable=False),
        UniqueConstraint("parent_id"),
    )
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.connect() as connection:
        text = mermaid(database_tables(connection))
    assert "parent |o..o{ optional" in text
    assert "parent ||..o{ required" in text
    assert "parent ||..o| unique_child" in text
    assert "||..|{" not in text  # FK never mandates that every parent has a child.


def test_dynamic_path_is_not_misreported_as_confirmed_handler():
    assert (
        _match("/planning/jobs/{…}", {("GET", "/planning/jobs/by-key"): "by_key"}) == []
    )


def test_observed_method_and_concrete_path_match_only_the_actual_operation():
    table = {
        ("GET", "/jobs/by-key"): "lookup",
        ("GET", "/jobs/{job_id}"): "job",
        ("POST", "/jobs"): "create",
    }
    assert match_observed("GET", "/jobs/abc", table)["handler"] == "job"
    assert (
        match_observed("GET", "/jobs/by-key?key=synthetic", table)["handler"]
        == "lookup"
    )
    assert match_observed("POST", "/jobs/abc", table)["state"] == "unresolved"


def test_dashboard_read_adapter_is_in_static_candidate_map():
    from devtools.er.ia_map import graph

    _, calls = graph()
    assert {"/planning/dashboard", "/planning/scopes"} <= calls[
        "components/dashboard/LiveDashboard"
    ]
