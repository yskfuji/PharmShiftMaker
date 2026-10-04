"""Administrative originals; never silently add fields to immutable solver inputs."""

from typing import Literal, Self

from pydantic import AwareDatetime, Field, model_validator

from shift_scheduler.domain.planning import Evidence, Value


class EmployerRecord(Value):
    employer_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=256)
    evidence: Evidence


class CapabilityAmendment(Value):
    amendment_id: str = Field(min_length=1, max_length=64)
    person_id: str = Field(min_length=1, max_length=64)
    target_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    effective_at: AwareDatetime
    reason: str = Field(min_length=1, max_length=2000)
    evidence: Evidence

    @model_validator(mode="after")
    def seconds(self) -> Self:
        if self.effective_at.microsecond:
            raise ValueError("Capability amendments require whole-second precision")
        return self


class ScopeSetting(Value):
    """A planning scope's workflow setting, switched by an administrator with evidence.

    absence_replacement_consent: when enabled, the person named as the replacement in
    an absence case must consent before the case can be approved.
    """

    setting_id: Literal["absence_replacement_consent"]
    enabled: bool
    reason: str = Field(min_length=3, max_length=500)
    evidence: Evidence
