"""The finite set of institution-approved duty patterns, without staff heuristics."""

from datetime import date
from typing import Self

from pydantic import Field, model_validator

from .planning import Value


class OffsetSpan(Value):
    start_seconds: int = Field(ge=0)
    end_seconds: int = Field(gt=0)


class DutyTemplate(Value):
    template_id: str = Field(min_length=1)
    kind: str
    task: str
    location: str
    dates: tuple[date, ...]
    start_second: int = Field(ge=0, lt=86400)
    duration_seconds: int = Field(gt=0, le=172800)
    work: tuple[OffsetSpan, ...]
    scheduled_work: tuple[OffsetSpan, ...]

    @model_validator(mode="after")
    def partition(self) -> Self:
        spans = sorted(self.work, key=lambda s: s.start_seconds)
        if (
            not spans
            or any(
                s.start_seconds >= s.end_seconds
                or s.end_seconds > self.duration_seconds
                for s in spans
            )
            or any(
                a.end_seconds > b.start_seconds
                for a, b in zip(spans, spans[1:], strict=False)
            )
        ):
            raise ValueError("Duty template work spans must be positive and disjoint")
        scheduled = sorted(self.scheduled_work, key=lambda s: s.start_seconds)
        if any(
            s.start_seconds >= s.end_seconds
            or not any(
                w.start_seconds <= s.start_seconds and s.end_seconds <= w.end_seconds
                for w in spans
            )
            for s in scheduled
        ) or any(
            a.end_seconds > b.start_seconds
            for a, b in zip(scheduled, scheduled[1:], strict=False)
        ):
            raise ValueError("Scheduled classification must explicitly fit within work")
        if len(set(self.dates)) != len(self.dates):
            raise ValueError("Duplicate duty template date")
        return self
