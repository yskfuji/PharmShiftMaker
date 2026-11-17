"""Staff management API backed by the SQL database."""

from __future__ import annotations

from collections.abc import Generator, Iterable
from datetime import UTC, date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from shift_scheduler.api.dependencies import AppRole, require_roles
from shift_scheduler.data.loaders import (
    is_db_backend,
    load_people,
    load_timeline_entries,
)
from shift_scheduler.db.models import PersonModel, ProfileModel, TimelineEntryModel
from shift_scheduler.db.session import session_scope
from shift_scheduler.domain.enums import Role as StaffRole
from shift_scheduler.domain.enums import TimelineStatus
from shift_scheduler.domain.models import Person as DomainPerson
from shift_scheduler.domain.models import TimelineEntry as DomainTimelineEntry

router = APIRouter(prefix="/staff", tags=["staff"])


def _maybe_get_db_session() -> Generator[Session | None, None, None]:
    if not is_db_backend():
        yield None
        return
    with session_scope() as session:
        yield session


class StaffTimelinePayload(BaseModel):
    profile_id: str = Field(..., description="Profile to apply during the period")
    from_date: date = Field(..., description="Start date (inclusive)")
    to_date: date | None = Field(
        default=None, description="End date (inclusive). None = open-ended"
    )
    status: TimelineStatus = Field(
        default=TimelineStatus.ACTIVE, description="Timeline status"
    )


class StaffTimelineResponse(BaseModel):
    timeline_id: int
    profile_id: str
    from_date: date
    to_date: date | None
    status: TimelineStatus


class StaffRecord(BaseModel):
    person_id: str
    name: str
    role: StaffRole
    created_at: datetime
    updated_at: datetime
    current_profile_id: str | None
    current_status: TimelineStatus | None
    timeline: list[StaffTimelineResponse] = Field(default_factory=list)


class StaffListResponse(BaseModel):
    total: int
    items: list[StaffRecord]


class StaffCreateRequest(BaseModel):
    person_id: str
    name: str
    role: StaffRole
    timeline: list[StaffTimelinePayload] = Field(default_factory=list)


class StaffUpdateRequest(BaseModel):
    name: str | None = Field(default=None, description="Updated display name")
    role: StaffRole | None = Field(default=None, description="Updated business role")


class TimelineUpdateRequest(BaseModel):
    profile_id: str | None = None
    from_date: date | None = None
    to_date: date | None = None
    status: TimelineStatus | None = None


def _ensure_profiles_exist(session: Session, profile_ids: Iterable[str]) -> None:
    ids = {profile_id for profile_id in profile_ids if profile_id}
    if not ids:
        return
    stmt = select(ProfileModel.profile_id).where(ProfileModel.profile_id.in_(ids))
    existing = set(session.execute(stmt).scalars().all())
    missing = ids - existing
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown profile_id(s): {', '.join(sorted(missing))}",
        )


def _load_person(session: Session, person_id: str) -> PersonModel:
    stmt = (
        select(PersonModel)
        .options(selectinload(PersonModel.timeline_entries))
        .where(PersonModel.person_id == person_id)
    )
    person = session.execute(stmt).unique().scalar_one_or_none()
    if person is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Staff not found"
        )
    return person


def _map_timeline(entry: TimelineEntryModel) -> StaffTimelineResponse:
    return StaffTimelineResponse(
        timeline_id=entry.id,
        profile_id=entry.profile_id,
        from_date=entry.from_date,
        to_date=entry.to_date,
        status=TimelineStatus(entry.status),
    )


def _active_entry(entries: list[TimelineEntryModel]) -> TimelineEntryModel | None:
    today = date.today()
    sorted_entries = sorted(entries, key=lambda item: item.from_date)
    for entry in reversed(sorted_entries):
        if entry.status != TimelineStatus.ACTIVE.value:
            continue
        if entry.from_date > today:
            continue
        if entry.to_date is None or entry.to_date >= today:
            return entry
    return None


def _person_to_record(person: PersonModel) -> StaffRecord:
    timeline_entries = sorted(
        person.timeline_entries, key=lambda entry: entry.from_date
    )
    current_entry = _active_entry(list(timeline_entries))
    return StaffRecord(
        person_id=person.person_id,
        name=person.name,
        role=StaffRole(person.role),
        created_at=person.created_at,
        updated_at=person.updated_at,
        current_profile_id=current_entry.profile_id if current_entry else None,
        current_status=TimelineStatus(current_entry.status) if current_entry else None,
        timeline=[_map_timeline(entry) for entry in timeline_entries],
    )


def _filter_active(persons: list[PersonModel]) -> list[PersonModel]:
    today = date.today()
    active_people: list[PersonModel] = []
    for person in persons:
        for entry in person.timeline_entries:
            if entry.status != TimelineStatus.ACTIVE.value:
                continue
            if entry.from_date <= today and (
                entry.to_date is None or entry.to_date >= today
            ):
                active_people.append(person)
                break
    return active_people


def _list_staff_from_yaml(include_inactive: bool) -> StaffListResponse:
    people = load_people()
    timeline_entries = load_timeline_entries()
    timeline_by_person: dict[str, list[DomainTimelineEntry]] = {}
    for entry in timeline_entries:
        timeline_by_person.setdefault(entry.person_id, []).append(entry)

    records: list[StaffRecord] = []
    for person in people:
        entries = timeline_by_person.get(person.person_id, [])
        if not include_inactive and not _yaml_entries_active(entries):
            continue
        records.append(_person_to_yaml_record(person, entries))
    return StaffListResponse(total=len(records), items=records)


def _get_yaml_staff(person_id: str) -> StaffRecord:
    people = {person.person_id: person for person in load_people()}
    person = people.get(person_id)
    if person is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Staff not found"
        )
    entries = [
        entry for entry in load_timeline_entries() if entry.person_id == person_id
    ]
    return _person_to_yaml_record(person, entries)


def _yaml_entries_active(entries: list[DomainTimelineEntry]) -> bool:
    if not entries:
        return False
    today = date.today()
    for entry in entries:
        if entry.status != TimelineStatus.ACTIVE:
            continue
        if entry.from_date <= today and (
            entry.to_date is None or entry.to_date >= today
        ):
            return True
    return False


def _active_yaml_entry(
    entries: list[DomainTimelineEntry],
) -> DomainTimelineEntry | None:
    today = date.today()
    for entry in sorted(entries, key=lambda item: item.from_date, reverse=True):
        if entry.status != TimelineStatus.ACTIVE:
            continue
        if entry.from_date > today:
            continue
        if entry.to_date is None or entry.to_date >= today:
            return entry
    return None


def _person_to_yaml_record(
    person: DomainPerson, entries: list[DomainTimelineEntry]
) -> StaffRecord:
    sorted_entries = sorted(entries, key=lambda entry: entry.from_date)
    current_entry = _active_yaml_entry(sorted_entries)
    created_at, updated_at = _infer_yaml_timestamps(sorted_entries)
    timeline_responses = [
        StaffTimelineResponse(
            timeline_id=index,
            profile_id=entry.profile_id,
            from_date=entry.from_date,
            to_date=entry.to_date,
            status=entry.status,
        )
        for index, entry in enumerate(sorted_entries, start=1)
    ]
    return StaffRecord(
        person_id=person.person_id,
        name=person.name,
        role=StaffRole(person.role.value),
        created_at=created_at,
        updated_at=updated_at,
        current_profile_id=current_entry.profile_id if current_entry else None,
        current_status=current_entry.status if current_entry else None,
        timeline=timeline_responses,
    )


def _infer_yaml_timestamps(
    entries: list[DomainTimelineEntry],
) -> tuple[datetime, datetime]:
    if not entries:
        now = datetime.now(UTC)
        return now, now
    first = entries[0]
    last = entries[-1]
    created_at = datetime.combine(first.from_date, time.min, tzinfo=UTC)
    last_date = last.to_date or last.from_date
    updated_at = datetime.combine(last_date, time.min, tzinfo=UTC)
    return created_at, updated_at


@router.get("/", response_model=StaffListResponse)
def list_staff(
    include_inactive: bool = Query(
        default=False, description="Set true to include inactive staff"
    ),
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.LEADER, AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffListResponse:
    if session is None:
        return _list_staff_from_yaml(include_inactive)
    stmt = select(PersonModel).options(selectinload(PersonModel.timeline_entries))
    people = session.execute(stmt).unique().scalars().all()
    if not include_inactive:
        people = _filter_active(list(people))
    records = [_person_to_record(person) for person in people]
    return StaffListResponse(total=len(records), items=records)


@router.get("/{person_id}", response_model=StaffRecord)
def get_staff(
    person_id: str,
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.LEADER, AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffRecord:
    if session is None:
        return _get_yaml_staff(person_id)
    person = _load_person(session, person_id)
    return _person_to_record(person)


@router.post("/", response_model=StaffRecord, status_code=status.HTTP_201_CREATED)
def create_staff(
    payload: StaffCreateRequest,
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffRecord:
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database backend is disabled in YAML mode",
        )
    if session.get(PersonModel, payload.person_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="person_id already exists"
        )
    person = PersonModel(
        person_id=payload.person_id, name=payload.name, role=payload.role.value
    )
    session.add(person)
    session.flush()
    if payload.timeline:
        _ensure_profiles_exist(session, {item.profile_id for item in payload.timeline})
        for entry in payload.timeline:
            session.add(
                TimelineEntryModel(
                    person_id=person.person_id,
                    profile_id=entry.profile_id,
                    from_date=entry.from_date,
                    to_date=entry.to_date,
                    status=entry.status.value,
                )
            )
    session.flush()
    person = _load_person(session, person.person_id)
    return _person_to_record(person)


@router.patch("/{person_id}", response_model=StaffRecord)
def update_staff(
    person_id: str,
    payload: StaffUpdateRequest,
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffRecord:
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database backend is disabled in YAML mode",
        )
    person = _load_person(session, person_id)
    if payload.name is not None:
        person.name = payload.name
    if payload.role is not None:
        person.role = payload.role.value
    session.add(person)
    session.flush()
    person = _load_person(session, person_id)
    return _person_to_record(person)


@router.post(
    "/{person_id}/timeline",
    response_model=StaffRecord,
    status_code=status.HTTP_201_CREATED,
)
def add_timeline_entry(
    person_id: str,
    payload: StaffTimelinePayload,
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffRecord:
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database backend is disabled in YAML mode",
        )
    person = _load_person(session, person_id)
    _ensure_profiles_exist(session, {payload.profile_id})
    session.add(
        TimelineEntryModel(
            person_id=person.person_id,
            profile_id=payload.profile_id,
            from_date=payload.from_date,
            to_date=payload.to_date,
            status=payload.status.value,
        )
    )
    session.flush()
    person = _load_person(session, person_id)
    return _person_to_record(person)


@router.patch("/{person_id}/timeline/{timeline_id}", response_model=StaffRecord)
def update_timeline_entry(
    person_id: str,
    timeline_id: int,
    payload: TimelineUpdateRequest,
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffRecord:
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database backend is disabled in YAML mode",
        )
    _load_person(session, person_id)
    entry = session.get(TimelineEntryModel, timeline_id)
    if entry is None or entry.person_id != person_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Timeline entry not found"
        )
    if payload.profile_id is not None:
        _ensure_profiles_exist(session, {payload.profile_id})
        entry.profile_id = payload.profile_id
    if payload.from_date is not None:
        entry.from_date = payload.from_date
    if payload.to_date is not None:
        entry.to_date = payload.to_date
    if payload.status is not None:
        entry.status = payload.status.value
    session.add(entry)
    session.flush()
    person = _load_person(session, person_id)
    return _person_to_record(person)


@router.delete("/{person_id}/timeline/{timeline_id}", response_model=StaffRecord)
def delete_timeline_entry(
    person_id: str,
    timeline_id: int,
    session: Session | None = Depends(_maybe_get_db_session),
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> StaffRecord:
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database backend is disabled in YAML mode",
        )
    _load_person(session, person_id)
    entry = session.get(TimelineEntryModel, timeline_id)
    if entry is None or entry.person_id != person_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Timeline entry not found"
        )
    session.delete(entry)
    session.flush()
    person = _load_person(session, person_id)
    return _person_to_record(person)


__all__ = [
    "router",
]
