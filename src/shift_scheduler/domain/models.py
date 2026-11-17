"""ドメインモデルのデータクラス定義.

病院薬剤科のシフトスケジューリングにおける中核的なビジネスオブジェクトです。
Person(人)、Profile(業務プロファイル)、Timeline(履歴)の3層構造により、
入職・退職・権限変更などをデータとして柔軟に管理します。

すべてのクラスはPydantic BaseModelを使用し、型安全性とバリデーションを担保します。
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .enums import (
    DayType,
    EmploymentType,
    HolidayRequestKind,
    Role,
    ShiftCategory,
    TimelineStatus,
)

if TYPE_CHECKING:
    from pydantic import ValidationInfo


class Person(BaseModel):
    """職員個人を表すモデル.

    システム内で一意に識別される「人そのもの」を表現します。
    氏名や基本属性は変わらないものとし、業務上の権限や雇用形態の変化は
    Profileとそのタイムライン(TimelineEntry)で管理します。

    Attributes:
        person_id: 職員を一意に識別するID(例: "sato", "yahagi")
        name: 氏名(例: "佐藤", "矢作")
        role: 役割(薬剤師 or 調剤補佐)
    """

    model_config = ConfigDict(frozen=True)

    person_id: str = Field(..., description="職員ID(一意)")
    name: str = Field(..., description="氏名")
    role: Role = Field(..., description="役割(薬剤師/調剤補佐)")


class Profile(BaseModel):
    """業務プロファイルを表すモデル.

    「新人薬剤師」「ベテラン薬剤師」「管理者(夜勤不可)」「パート(特定曜日のみ)」
    などの業務上の権限・制約をまとめたテンプレートです。
    複数の職員が同じProfileを参照することもあります。

    Attributes:
        profile_id: プロファイルを一意に識別するID(例: "veteran", "newbie")
        name: プロファイル名(例: "ベテラン薬剤師", "新人薬剤師")
        employment_type: 雇用形態(正社員/パート/休職中)
        can_night_duty: 夜勤(平日16:30〜翌9:00)が可能かどうか
        can_on_call: 当直(土日祝日8:30〜翌9:00)が可能かどうか
        can_evening: 夕診(平日夕方)が可能かどうか
        can_ward_alone: 病棟業務に単独で入れるかどうか(新人はFalse)
        weekend_allowed: 土曜日に勤務可能かどうか
        holiday_allowed: 日曜・祝日に勤務可能かどうか
        allowed_weekdays: 勤務可能な曜日のリスト(0=月曜, 6=日曜)。Noneは全曜日可
        max_consecutive_working_days: 最大連勤日数(通常6日)
        night_duty_min: 夜勤の月間最低回数(夜勤可能者は通常1回)
        night_duty_max: 夜勤の月間最大回数(通常4回)
        on_call_min: 当直の月間最低回数(当直可能者は通常1回)
        on_call_max: 当直の月間最大回数(通常4回)
        evening_min: 夕診の月間最低回数(夕診可能者は通常2回)
        evening_max: 夕診の月間最大回数(通常4回)
    """

    profile_id: str = Field(..., description="プロファイルID(一意)")
    name: str = Field(..., description="プロファイル名")
    employment_type: EmploymentType = Field(..., description="雇用形態")
    can_night_duty: bool = Field(default=False, description="夜勤可能")
    can_on_call: bool = Field(default=False, description="当直可能")
    can_evening: bool = Field(default=True, description="夕診可能")
    can_ward_alone: bool = Field(default=True, description="病棟単独可能")
    weekend_allowed: bool = Field(default=True, description="土曜勤務可能")
    holiday_allowed: bool = Field(default=True, description="日祝勤務可能")
    allowed_weekdays: list[int] | None = Field(
        default=None,
        description="勤務可能曜日(0=月, 6=日)。Noneは全曜日可",
    )
    max_consecutive_working_days: int = Field(default=6, description="最大連勤日数")
    night_duty_min: int = Field(default=0, description="夜勤月間最低回数")
    night_duty_max: int = Field(default=0, description="夜勤月間最大回数")
    on_call_min: int = Field(default=0, description="当直月間最低回数")
    on_call_max: int = Field(default=0, description="当直月間最大回数")
    evening_min: int = Field(default=0, description="夕診月間最低回数")
    evening_max: int = Field(default=0, description="夕診月間最大回数")

    @field_validator("allowed_weekdays")
    @classmethod
    def validate_weekdays(cls, v: list[int] | None) -> list[int] | None:
        """曜日リストが0〜6の範囲内かチェック."""
        if v is not None and not all(0 <= day <= 6 for day in v):
            raise ValueError("allowed_weekdaysは0〜6の範囲で指定してください")
        return v


class TimelineEntry(BaseModel):
    """職員の在籍期間とプロファイルの紐付けを表すモデル.

    ある職員が、いつからいつまで、どのプロファイル(権限・制約)で
    勤務していたかを記録します。
    入職・退職・出向・育休・パート化・正社員復帰などを期間で表現します。

    Attributes:
        person_id: 対象職員のID
        from_date: この設定が有効な開始日(この日を含む)
        to_date: この設定が有効な終了日(この日を含む)。Noneは無期限
        profile_id: この期間に適用されるプロファイルID
        status: 在籍状況(ACTIVE/INACTIVE/LEAVE)
    """

    person_id: str = Field(..., description="職員ID")
    from_date: date = Field(..., description="開始日(この日を含む)")
    to_date: date | None = Field(
        default=None, description="終了日(この日を含む)。Noneは無期限"
    )
    profile_id: str = Field(..., description="適用プロファイルID")
    status: TimelineStatus = Field(..., description="在籍状況")

    @field_validator("to_date")
    @classmethod
    def validate_date_range(
        cls, to_date: date | None, info: ValidationInfo
    ) -> date | None:
        """終了日が開始日以降かチェック."""
        from_date = info.data.get("from_date")
        if to_date is not None and from_date is not None and to_date < from_date:
            raise ValueError("終了日は開始日以降である必要があります")
        return to_date


class DayInfo(BaseModel):
    """1日分の情報を表すモデル.

    カレンダー上の1日について、その日の種別(平日・土日祝など)と
    必要なシフト種別・人数を定義します。

    Attributes:
        day_date: 対象日付
        day_type: 日付の種別(平日/土曜/日曜/祝日/年末年始)
        is_business_day: 営業日かどうか(病院は基本的に全日営業)
    """

    model_config = ConfigDict(frozen=True)

    day_date: date = Field(..., description="対象日付")
    day_type: DayType = Field(..., description="日付の種別")
    is_business_day: bool = Field(
        default=True, description="営業日かどうか(病院は基本的に全日営業)"
    )


class ShiftType(BaseModel):
    """シフト種別を表すモデル.

    「2A」「3B」「日勤」「夜勤」など、1つのシフトの定義です。
    どの日付種別(平日/土日祝)で発生するか、何人必要か、
    どのカテゴリ(病棟/日勤/夜勤など)に属するかを定義します。

    Attributes:
        shift_id: シフトを一意に識別するID(例: "2A", "DAY_SHIFT")
        name: シフト名(表示用)
        category: シフトカテゴリ(病棟/日勤/夕診/夜勤/当直/休み)
        required_count: 必要人数(このシフトに何人割り当てるか)
        applicable_day_types: このシフトが発生する日付種別のリスト
    """

    model_config = ConfigDict(frozen=True)

    shift_id: str = Field(..., description="シフトID(一意)")
    name: str = Field(..., description="シフト名(表示用)")
    category: ShiftCategory = Field(..., description="シフトカテゴリ")
    required_count: int = Field(default=1, ge=0, description="必要人数")
    applicable_day_types: list[DayType] = Field(
        ..., description="このシフトが発生する日付種別"
    )


class Assignment(BaseModel):
    """職員へのシフト割り当て結果を表すモデル.

    最適化ソルバが生成したシフト表の1行(1人1日1シフト)に相当します。

    Attributes:
        person_id: 割り当てられる職員のID
        assignment_date: 割り当て日付
        shift_id: 割り当てられるシフトのID("OFF"の場合は休日)
    """

    model_config = ConfigDict(frozen=True)

    person_id: str = Field(..., description="職員ID")
    assignment_date: date = Field(..., description="割り当て日付")
    shift_id: str = Field(..., description="シフトID(OFFは休日)")


class HolidayRequest(BaseModel):
    """職員からの休み希望を表すモデル.

    各職員は月に最大4日まで休み希望を登録でき、
    公休希望と有給希望を区別して管理します。
    申請順序(早いほど優先)も記録します。

    Attributes:
        person_id: 希望を出した職員のID
        request_date: 休みたい日付
        kind: 希望の種別(公休希望/有給希望)
        order: 申請順序(小さいほど早く申請された)
        is_approved: 希望が採用されたかどうか(ソルバが決定)
    """

    person_id: str = Field(..., description="職員ID")
    request_date: date = Field(..., description="休みたい日付")
    kind: HolidayRequestKind = Field(..., description="希望の種別")
    order: int = Field(..., ge=1, description="申請順序(1から始まる)")
    is_approved: bool = Field(default=False, description="希望が採用されたか")


class LeaveQuota(BaseModel):
    """年間の休暇枠を表すモデル."""

    person_id: str = Field(..., description="職員ID")
    year: int = Field(..., ge=2000, le=2100, description="対象年")
    kind: HolidayRequestKind = Field(..., description="対象休暇種別")
    total_days: int = Field(..., ge=0, description="年間付与日数")
    used_days: int = Field(default=0, ge=0, description="当該年で既に消化済みの日数")
    used_before_month: int = Field(
        default=0, ge=0, description="当該月より前に消化済みの日数"
    )


# ============================================================
# 使用例(インスタンス生成の短いコード例)
# ============================================================
#
# from datetime import date
# from shift_scheduler.domain import (
#     Person, Profile, TimelineEntry, DayInfo, ShiftType,
#     Assignment, HolidayRequest,
#     Role, EmploymentType, TimelineStatus, DayType,
#     ShiftCategory, HolidayRequestKind
# )
#
# # 1. Person(人)の作成
# person_sato = Person(
#     person_id="sato",
#     name="佐藤",
#     role=Role.PHARMACIST
# )
#
# # 2. Profile(業務プロファイル)の作成
# profile_manager = Profile(
#     profile_id="manager",
#     name="管理者(夜勤不可)",
#     employment_type=EmploymentType.FULL_TIME,
#     can_night_duty=False,
#     can_on_call=False,
#     can_evening=True,
#     can_ward_alone=True,
#     weekend_allowed=False,  # 土日祝休み
#     holiday_allowed=False,
#     max_consecutive_working_days=6
# )
#
# # 3. TimelineEntry(在籍履歴)の作成
# timeline_sato = TimelineEntry(
#     person_id="sato",
#     from_date=date(2020, 4, 1),
#     to_date=None,  # 無期限
#     profile_id="manager",
#     status=TimelineStatus.ACTIVE
# )
#
# # 4. DayInfo(日付情報)の作成
# day_info = DayInfo(
#     day_date=date(2025, 2, 3),
#     day_type=DayType.WEEKDAY,
#     is_business_day=True
# )
#
# # 5. ShiftType(シフト種別)の作成
# shift_2a = ShiftType(
#     shift_id="2A",
#     name="2A病棟",
#     category=ShiftCategory.WARD,
#     required_count=1,
#     applicable_day_types=[DayType.WEEKDAY]
# )
#
# # 6. Assignment(割り当て結果)の作成
# assignment = Assignment(
#     person_id="yahagi",
#     assignment_date=date(2025, 2, 3),
#     shift_id="2A"
# )
#
# # 7. HolidayRequest(休み希望)の作成
# request = HolidayRequest(
#     person_id="yahagi",
#     request_date=date(2025, 2, 10),
#     kind=HolidayRequestKind.PAID_LEAVE_REQUEST,
#     order=1,
#     is_approved=False
# )
#
# print(f"Person: {person_sato.name} ({person_sato.role})")
# print(f"Profile: {profile_manager.name}")
# print(f"Timeline: {timeline_sato.person_id} - {timeline_sato.status}")
# print(f"DayInfo: {day_info.day_date} ({day_info.day_type})")
# print(f"ShiftType: {shift_2a.name} ({shift_2a.category})")
# print(f"Assignment: {assignment.person_id} -> {assignment.shift_id}")
# print(f"HolidayRequest: {request.person_id} on {request.request_date} ({request.kind})")
