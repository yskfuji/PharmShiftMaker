"use client";
import { ApiScheduleResponse, serializeAssignment, transformResponse } from "@/lib/scheduleTransformers";
import { ScheduleAssignment, ScheduleGenerateResponse } from "@/lib/types";

import {API_BASE_URL} from "./apiTarget";

export interface ClientScheduleParams {
  year: number;
  month: number;
  trialMode: boolean;
  expectedVersion?: number;
  manualAssignments?: ScheduleAssignment[];
}

export async function requestScheduleGeneration(
  params: ClientScheduleParams,
): Promise<ScheduleGenerateResponse> {

  const body: Record<string, unknown> = {
    year: params.year,
    month: params.month,
    trial_mode: params.trialMode,
  };
  if (typeof params.expectedVersion === "number") {
    body.expected_version = params.expectedVersion;
  }
  if (params.manualAssignments && params.manualAssignments.length > 0) {
    body.manual_assignments = params.manualAssignments.map(serializeAssignment);
  }

  const response = await fetch(`${API_BASE_URL}/schedules/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `スケジュール生成に失敗しました (${response.status})`);
  }

  const payload = (await response.json()) as ApiScheduleResponse;
  return transformResponse(payload);
}
