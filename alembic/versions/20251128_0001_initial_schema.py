"""Initial relational schema for PharmShift."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251128_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "people",
        sa.Column("person_id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "profiles",
        sa.Column("profile_id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("employment_type", sa.String(length=32), nullable=False),
        sa.Column("can_night_duty", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_on_call", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_evening", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("can_ward_alone", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("weekend_allowed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("holiday_allowed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allowed_weekdays", sa.JSON(), nullable=True),
    sa.Column("max_consecutive_working_days", sa.Integer(), nullable=False, server_default=sa.text("6")),
    sa.Column("night_duty_min", sa.Integer(), nullable=False, server_default=sa.text("0")),
    sa.Column("night_duty_max", sa.Integer(), nullable=False, server_default=sa.text("0")),
    sa.Column("on_call_min", sa.Integer(), nullable=False, server_default=sa.text("0")),
    sa.Column("on_call_max", sa.Integer(), nullable=False, server_default=sa.text("0")),
    sa.Column("evening_min", sa.Integer(), nullable=False, server_default=sa.text("0")),
    sa.Column("evening_max", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "staff_timeline",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("profile_id", sa.String(length=64), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["people.person_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.profile_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("person_id", "from_date", name="uq_timeline_person_from"),
    )

    op.create_table(
        "holiday_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("request_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("is_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["people.person_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("person_id", "request_date", name="uq_holiday_requests_person_date"),
    )

    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
    sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("year", "month", name="uq_schedule_year_month"),
    )

    op.create_table(
        "schedule_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("schedule_id", sa.Integer(), nullable=False),
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("assignment_date", sa.Date(), nullable=False),
        sa.Column("shift_id", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["schedule_id"], ["schedules.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "schedule_id",
            "person_id",
            "assignment_date",
            "shift_id",
            name="uq_schedule_assignment",
        ),
    )

    op.create_index("ix_schedule_assignments_person", "schedule_assignments", ["person_id"])
    op.create_index("ix_schedule_assignments_date", "schedule_assignments", ["assignment_date"])


def downgrade() -> None:
    op.drop_index("ix_schedule_assignments_date", table_name="schedule_assignments")
    op.drop_index("ix_schedule_assignments_person", table_name="schedule_assignments")
    op.drop_table("schedule_assignments")
    op.drop_table("schedules")
    op.drop_table("holiday_requests")
    op.drop_table("staff_timeline")
    op.drop_table("profiles")
    op.drop_table("people")
