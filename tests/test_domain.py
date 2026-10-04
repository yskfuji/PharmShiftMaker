"""ドメインモデルの単体テスト.

Person, Profile, TimelineEntry, DayInfo, ShiftType, Assignment, HolidayRequest
の基本的な振る舞いとバリデーションをテストします。
"""

from datetime import date

import pytest

from shift_scheduler.domain import (
    Assignment,
    DayInfo,
    DayType,
    EmploymentType,
    HolidayRequest,
    HolidayRequestKind,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)


class TestPerson:
    """Personクラスのテスト."""

    def test_create_person(self) -> None:
        """Personインスタンスの作成テスト."""
        person = Person(
            person_id="sato",
            name="佐藤",
            role=Role.PHARMACIST,
        )
        assert person.person_id == "sato"
        assert person.name == "佐藤"
        assert person.role == Role.PHARMACIST

    def test_person_is_frozen(self) -> None:
        """Personがイミュータブルであることのテスト."""
        person = Person(
            person_id="sato",
            name="佐藤",
            role=Role.PHARMACIST,
        )
        with pytest.raises((ValueError, AttributeError)):
            person.name = "田中"  # type: ignore[misc]


class TestProfile:
    """Profileクラスのテスト."""

    def test_create_profile(self) -> None:
        """Profileインスタンスの作成テスト."""
        profile = Profile(
            profile_id="veteran",
            name="ベテラン薬剤師",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=True,
            can_on_call=True,
            can_evening=True,
            can_ward_alone=True,
        )
        assert profile.profile_id == "veteran"
        assert profile.can_night_duty is True
        assert profile.can_ward_alone is True

    def test_profile_allowed_weekdays_validation(self) -> None:
        """allowed_weekdaysのバリデーションテスト."""
        # 正常なケース
        profile = Profile(
            profile_id="part_time",
            name="パート薬剤師",
            employment_type=EmploymentType.PART_TIME,
            allowed_weekdays=[0, 2, 4],  # 月水金
        )
        assert profile.allowed_weekdays == [0, 2, 4]

        # 異常なケース（範囲外の値）
        with pytest.raises(ValueError):
            Profile(
                profile_id="invalid",
                name="無効なプロファイル",
                employment_type=EmploymentType.PART_TIME,
                allowed_weekdays=[0, 7],  # 7は範囲外
            )


class TestTimelineEntry:
    """TimelineEntryクラスのテスト."""

    def test_create_timeline_entry(self) -> None:
        """TimelineEntryインスタンスの作成テスト."""
        entry = TimelineEntry(
            person_id="sato",
            from_date=date(2020, 4, 1),
            to_date=None,
            profile_id="manager",
            status=TimelineStatus.ACTIVE,
        )
        assert entry.person_id == "sato"
        assert entry.from_date == date(2020, 4, 1)
        assert entry.to_date is None
        assert entry.status == TimelineStatus.ACTIVE

    def test_timeline_date_range_validation(self) -> None:
        """終了日が開始日以降であることのバリデーションテスト."""
        # 正常なケース
        entry = TimelineEntry(
            person_id="yahagi",
            from_date=date(2020, 4, 1),
            to_date=date(2023, 3, 31),
            profile_id="veteran",
            status=TimelineStatus.ACTIVE,
        )
        assert entry.to_date == date(2023, 3, 31)

        # 異常なケース（終了日が開始日より前）
        with pytest.raises(ValueError):
            TimelineEntry(
                person_id="yahagi",
                from_date=date(2023, 3, 31),
                to_date=date(2020, 4, 1),
                profile_id="veteran",
                status=TimelineStatus.ACTIVE,
            )


class TestDayInfo:
    """DayInfoクラスのテスト."""

    def test_create_day_info(self) -> None:
        """DayInfoインスタンスの作成テスト."""
        day_info = DayInfo(
            day_date=date(2025, 2, 3),
            day_type=DayType.WEEKDAY,
            is_business_day=True,
        )
        assert day_info.day_date == date(2025, 2, 3)
        assert day_info.day_type == DayType.WEEKDAY
        assert day_info.is_business_day is True


class TestShiftType:
    """ShiftTypeクラスのテスト."""

    def test_create_shift_type(self) -> None:
        """ShiftTypeインスタンスの作成テスト."""
        shift = ShiftType(
            shift_id="2A",
            name="2A病棟",
            category=ShiftCategory.WARD,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
        assert shift.shift_id == "2A"
        assert shift.category == ShiftCategory.WARD
        assert shift.required_count == 1


class TestAssignment:
    """Assignmentクラスのテスト."""

    def test_create_assignment(self) -> None:
        """Assignmentインスタンスの作成テスト."""
        assignment = Assignment(
            person_id="yahagi",
            assignment_date=date(2025, 2, 3),
            shift_id="2A",
        )
        assert assignment.person_id == "yahagi"
        assert assignment.assignment_date == date(2025, 2, 3)
        assert assignment.shift_id == "2A"


class TestHolidayRequest:
    """HolidayRequestクラスのテスト."""

    def test_create_holiday_request(self) -> None:
        """HolidayRequestインスタンスの作成テスト."""
        request = HolidayRequest(
            person_id="yahagi",
            request_date=date(2025, 2, 10),
            kind=HolidayRequestKind.PAID_LEAVE_REQUEST,
            order=1,
            is_approved=False,
        )
        assert request.person_id == "yahagi"
        assert request.kind == HolidayRequestKind.PAID_LEAVE_REQUEST
        assert request.order == 1
        assert request.is_approved is False

    def test_holiday_request_order_validation(self) -> None:
        """申請順序が1以上であることのバリデーションテスト."""
        # 正常なケース
        request = HolidayRequest(
            person_id="yahagi",
            request_date=date(2025, 2, 10),
            kind=HolidayRequestKind.PUBLIC_HOLIDAY_REQUEST,
            order=5,
        )
        assert request.order == 5

        # 異常なケース（0以下）
        with pytest.raises(ValueError):
            HolidayRequest(
                person_id="yahagi",
                request_date=date(2025, 2, 10),
                kind=HolidayRequestKind.PUBLIC_HOLIDAY_REQUEST,
                order=0,
            )
