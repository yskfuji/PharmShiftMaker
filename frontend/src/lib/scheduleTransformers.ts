import { ScheduleAssignment, ScheduleGenerateResponse, ScheduleWarning } from "@/lib/types";

export type ApiAssignment = {
  person_id: string;
  assignment_date: string;
  shift_id: string;
};

export type ApiScheduleWarning = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  context: Record<string, unknown>;
};

export type ApiScheduleResponse = {
  year: number;
  month: number;
  trial_mode: boolean;
  generated_at: string;
  total_assignments: number;
  assignments: ApiAssignment[];
  warnings?: ApiScheduleWarning[];
  lock_version?: number | null;
};

export function transformAssignment(item: ApiAssignment): ScheduleAssignment {
  return {
    personId: item.person_id,
    assignmentDate: item.assignment_date,
    shiftId: item.shift_id,
  };
}

export function transformWarning(item: ApiScheduleWarning): ScheduleWarning {
  return {
    code: item.code,
    severity: item.severity,
    message: item.message,
    context: item.context ?? {},
  };
}

export function transformResponse(payload: ApiScheduleResponse): ScheduleGenerateResponse {
  return {
    year: payload.year,
    month: payload.month,
    trialMode: payload.trial_mode,
    generatedAt: payload.generated_at,
    totalAssignments: payload.total_assignments,
    assignments: payload.assignments.map(transformAssignment),
    warnings: (payload.warnings ?? []).map(transformWarning),
    lockVersion: payload.lock_version ?? null,
  };
}

export function serializeAssignment(item: ScheduleAssignment): ApiAssignment {
  return {
    person_id: item.personId,
    assignment_date: item.assignmentDate,
    shift_id: item.shiftId,
  };
}
