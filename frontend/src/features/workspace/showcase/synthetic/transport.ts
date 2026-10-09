// Synthetic transport for Storybook and the showcase: the same typed client and the same
// route reads as production, answered from fictitious data. Nothing reaches a server.
import type { PlanningRequest } from "@/ideal/api/client";
import type { IdealRole } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { workspaceV3Routes, type FetchRoute } from "./routes";

const emptied = (value: unknown, key = ""): unknown => {
  if (Array.isArray(value)) return [];
  if (typeof value === "number" && /_count$/.test(key)) return 0;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, emptied(item, name)]));
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** One answer as the API gives it to a pharmacist: the lists the route marks `own` keep
 * only that person's entries, and a `visibility` says "self". */
const ownOnly = (value: unknown, own: string[], personId: string): unknown => {
  if (Array.isArray(value)) return value.map((item) => ownOnly(item, own, personId));
  if (!isRecord(value)) return value;
  const mine = Object.fromEntries(Object.entries(value).map(([name, item]) =>
    [name, own.includes(name) && Array.isArray(item) ? item.filter((entry) => isRecord(entry) && entry.person_id === personId) : item]));
  return Object.hasOwn(mine, "visibility") ? { ...mine, visibility: "self" } : mine;
};

const forRole = (answer: FetchRoute, role: IdealRole): unknown =>
  answer.byRole ? answer.byRole(role, `synthetic-${role.toLowerCase()}`)
    : role === "PHARMACIST" && answer.own ? ownOnly(answer.body, answer.own, "synthetic-pharmacist") : answer.body;

/**
 * `empty`: every list is empty, so a view shows what it says when there is nothing yet.
 * `role`: a pharmacist is answered as the API answers one (own duties and own name only).
 */
export function syntheticRequest(empty = false, role: IdealRole = "LEADER"): PlanningRequest {
  return async <T,>(path: string, method = "GET"): Promise<T> => {
    // A definite refusal: the showcase displays screens and changes nothing.
    if (method !== "GET") throw new PlanningError(422, "合成データの表示では変更を行いません。");
    const [pathname, query = ""] = `/planning${path}`.split("?");
    const answer = workspaceV3Routes.find((route) =>
      typeof route.path === "string" ? route.path === pathname : route.path.test(pathname));
    if (!answer) throw new PlanningError(501, `合成の応答がありません: ${pathname}`);
    const whole = forRole(answer, role);
    const body = answer.byQuery ? answer.byQuery(whole, new URLSearchParams(query)) : whole;
    return (empty ? emptied(body) : body) as T;
  };
}
