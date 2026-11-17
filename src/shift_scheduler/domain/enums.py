"""ドメインモデルで使用するEnum定義.

病院薬剤科のシフトスケジューリングにおける各種区分・状態を表現する列挙型です。
現場薬剤師が読んでも意味が分かるよう、日本語での説明を付与しています。
"""

from enum import Enum


class DayType(str, Enum):
    """日付の種別を表す列挙型.

    シフトのルールは日付の種別（平日・土曜・日曜・祝日・年末年始）によって
    大きく異なるため、各日付を正確に分類する必要があります。

    Attributes:
        WEEKDAY: 平日（月〜金で祝日でない日）
        SATURDAY: 土曜日
        SUNDAY: 日曜日
        HOLIDAY: 祝日（土日と重ならない祝日）
        YEAR_END: 年末年始（12/29〜1/3など、特別扱いする日）
    """

    WEEKDAY = "WEEKDAY"
    SATURDAY = "SATURDAY"
    SUNDAY = "SUNDAY"
    HOLIDAY = "HOLIDAY"
    YEAR_END = "YEAR_END"


class ShiftCategory(str, Enum):
    """シフト種別のカテゴリを表す列挙型.

    同じ「病棟」でも平日と土日では異なるシフト名になるため、
    カテゴリとして抽象化して扱うことで、制約の記述を簡潔にします。

    Attributes:
        WARD: 病棟業務（2A, 3B, 5A, 5B, 6A, HCU, 6B, 2AHCU, 6A6B, 病棟など）
        DAY_SHIFT: 日勤（調剤業務）
        EVENING: 夕診（平日夕方の外来診療対応）
        NIGHT_DUTY: 夜勤（平日 16:30〜翌9:00）
        ON_CALL: 当直（土日祝日 8:30〜翌9:00）
        OFF: 休日（勤務なし）
    """

    WARD = "WARD"
    DAY_SHIFT = "DAY_SHIFT"
    EVENING = "EVENING"
    NIGHT_DUTY = "NIGHT_DUTY"
    ON_CALL = "ON_CALL"
    OFF = "OFF"


class EmploymentType(str, Enum):
    """雇用形態を表す列挙型.

    正社員・パート・休職中などの区別により、勤務可能な曜日や
    シフトの種類が制限されます。

    Attributes:
        FULL_TIME: 正社員（常勤）
        PART_TIME: パート（非常勤）
        LEAVE: 休職中・育休中・長期出張中など（シフトに入らない）
    """

    FULL_TIME = "FULL_TIME"
    PART_TIME = "PART_TIME"
    LEAVE = "LEAVE"


class Role(str, Enum):
    """職員の役割を表す列挙型.

    薬剤師と調剤補佐では業務範囲が異なるため、区別して管理します。

    Attributes:
        PHARMACIST: 薬剤師（病棟・調剤・夜勤・当直が可能）
        ASSISTANT: 調剤補佐（日勤の補助のみ、薬剤師とペアで勤務）
    """

    PHARMACIST = "PHARMACIST"
    ASSISTANT = "ASSISTANT"


class HolidayRequestKind(str, Enum):
    """休み希望の種別を表す列挙型.

    公休希望と有給希望では、採用された場合の「実際の休日数」への
    影響が異なります。

    Attributes:
        PUBLIC_HOLIDAY_REQUEST: 公休希望（基準休日の範囲内で休む日を選択）
        PAID_LEAVE_REQUEST: 有給休暇希望（採用されると実際の休日数が増加）
        SUMMER_LEAVE_REQUEST: 夏季休暇の希望（年に数日のみ許容）
        REFRESH_LEAVE_REQUEST: リフレッシュ休暇の希望（特別休暇枠）
    """

    PUBLIC_HOLIDAY_REQUEST = "PUBLIC_HOLIDAY_REQUEST"
    PAID_LEAVE_REQUEST = "PAID_LEAVE_REQUEST"
    SUMMER_LEAVE_REQUEST = "SUMMER_LEAVE_REQUEST"
    REFRESH_LEAVE_REQUEST = "REFRESH_LEAVE_REQUEST"


class TimelineStatus(str, Enum):
    """タイムライン（職員の在籍状況）のステータスを表す列挙型.

    入職・退職・出向・育休などによって、ある期間だけシフトに入らない、
    あるいは権限が変わる、といった状況を表現します。

    Attributes:
        ACTIVE: 勤務中（シフトに入る対象）
        INACTIVE: 休職中・出向中など（シフトに入らない）
        LEAVE: 育休・産休など（シフトに入らない）
    """

    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    LEAVE = "LEAVE"
