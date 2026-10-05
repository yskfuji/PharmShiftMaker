import type { IdealRole } from "@/ideal/types";
import type { RouteContext } from "../../shell/routeTypes";
import { syntheticAssignments, syntheticNotifications, syntheticPeople } from "./routes";

export const syntheticViewerName = (role: IdealRole) =>
  role === "ADMIN" ? "佐藤 美咲" : role === "LEADER" ? "鈴木 悠斗" : "高橋 葵";

/**
 * Fictitious people, facility and publication. No real name, facility or record. A
 * pharmacist is given what the API gives one: no roster and only their own duties.
 * `empty`: the same scope with nothing yet: no names, a publication without assignments,
 * no notifications and no plan chosen in the URL.
 */
export function syntheticContext(role: IdealRole, empty = false): RouteContext {
  const personId = `synthetic-${role.toLowerCase()}`;
  const publication = {
    publication_id: "synthetic-publication-12",
    version: 12,
    period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00",
    validation_status: "verified_at_publication",
    assignments: empty ? [] : syntheticAssignments.filter((duty) => role !== "PHARMACIST" || duty.person_id === personId),
  };
  return {
    observedAt: "2026-10-12T08:16:00+09:00",
    day: "2026-10-12",
    period: "2026-10",
    viewerName: syntheticViewerName(role),
    scope: { scope_id: "synthetic/clinical-pharmacy", display_name: "東都医療センター · 薬剤部", person_id: personId, role, input_revision: 12 },
    role,
    publications: [publication],
    publication,
    selectedCaseId: null,
    selectedPersonId: null,
    // What a planning URL would name: the three compared plans; the first is the one edited.
    selectedDraftIds: empty ? [] : ["synthetic-draft-1", "synthetic-draft-2", "synthetic-draft-3"],
    selectedInputHash: null,
    names: empty || role === "PHARMACIST" ? {} : Object.fromEntries(syntheticPeople.map((person) => [person.person_id, person.name])),
    notifications: empty ? [] : syntheticNotifications,
    notificationsRead: true,
  };
}
