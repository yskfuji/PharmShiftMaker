"use server";

import { getAuthToken } from "@/lib/auth";
import { ensureHttpsDispatcher } from "@/lib/httpsDispatcher";
import { ScheduleGenerateParams, ScheduleGenerateResponse } from "@/lib/types";
import { ApiScheduleResponse, serializeAssignment, transformResponse } from "@/lib/scheduleTransformers";

import {API_BASE_URL} from "./apiTarget";

ensureHttpsDispatcher();

function extractErrorMessage(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed);
    const detail = (parsed as { detail?: unknown }).detail ?? parsed;
    if (typeof detail === "string") {
      return detail;
    }
    if (detail && typeof detail === "object") {
      const maybeMessage = (detail as Record<string, unknown>).message ?? (detail as Record<string, unknown>).error;
      if (typeof maybeMessage === "string") {
        return maybeMessage;
      }
      return JSON.stringify(detail);
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export async function generateSchedule(
  params: ScheduleGenerateParams,
): Promise<ScheduleGenerateResponse> {
  const token = await getAuthToken();
  const body: Record<string, unknown> = {
    year: params.year,
    month: params.month,
    trial_mode: params.trialMode ?? true,
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    const message = extractErrorMessage(responseBody) || response.statusText;
    throw new Error(`Failed to generate schedule (${response.status}): ${message}`);
  }

  const data = (await response.json()) as ApiScheduleResponse;
  return transformResponse(data);
}

export async function getConfirmedSchedule(year: number, month: number): Promise<ScheduleGenerateResponse> {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE_URL}/schedules/${year}/${month}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const responseBody = await response.text();
    const message = extractErrorMessage(responseBody) || response.statusText;
    throw new Error(`Failed to load confirmed schedule (${response.status}): ${message}`);
  }

  const data = (await response.json()) as ApiScheduleResponse;
  return transformResponse(data);
}
