// Server-side reads for the workspace. The session cookie is read here and nowhere else in
// the workspace; it is sent as a bearer token and never placed in props or in a context.
import { cookies } from "next/headers";
import type { PlanningRequest } from "@/ideal/api/client";
import { API_BASE_URL } from "@/lib/apiTarget";
import { AUTH_TOKEN_COOKIE } from "@/lib/authConstants";
import { ensureHttpsDispatcher } from "@/lib/httpsDispatcher";
import { PlanningError } from "@/lib/planningTransport";
import { oncePerRequest } from "./oncePerRequest";

async function detail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const value = JSON.parse(text) as { detail?: unknown };
    return typeof value.detail === "string" ? value.detail : text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

export type ServerTransport = {
  /** A path relative to the API root, e.g. `/auth/me`. */
  read: <T>(path: string) => Promise<T>;
  /** The planning transport the typed client expects (paths relative to `/planning`). */
  request: PlanningRequest;
};

/** Every response is specific to the signed-in viewer and is never cached beyond the request. */
export async function createServerTransport(): Promise<ServerTransport> {
  ensureHttpsDispatcher();
  let token: string | null = null;
  try {
    token = (await cookies()).get(AUTH_TOKEN_COOKIE)?.value ?? null;
  } catch {
    token = null;
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const read = oncePerRequest(async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new PlanningError(response.status, await detail(response));
    return response.json() as Promise<T>;
  });
  const request: PlanningRequest = <T,>(path: string, method = "GET"): Promise<T> => {
    // Changes are made by the browser with the viewer's idempotency key, never while rendering.
    if (method !== "GET") return Promise.reject(new PlanningError(405, "サーバーの読取りでは変更できません。"));
    return read<T>(`/planning${path}`);
  };
  return { read, request };
}
