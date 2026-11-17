"use client";

import type { ReactNode } from "react";
import type { IdealRole } from "../types";
import { SYNTHETIC_SOURCE, WorkspaceContext } from "./WorkspaceContext";
import { createIdealClient } from "../api/client";
import { createMutator } from "../api/mutations";
import { WORKSPACE_NAV } from "@/features/workspace/generated/usecaseRoutes";
import type { LiveApi } from "../live/context";

const publication = {
  publication_id: "synthetic-publication-12",
  version: 12,
  period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00",
  validation_status: "verified_at_publication",
  assignments: [
    { duty_id: "synthetic-duty-1", person_id: "synthetic-pharmacist", kind: "日勤", task: "病棟", location: "本館", start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00" },
    { duty_id: "synthetic-duty-2", person_id: "synthetic-leader", kind: "遅番", task: "調剤", location: "薬剤部", start: "2026-10-12T10:30:00+09:00", end: "2026-10-12T19:30:00+09:00" },
  ],
};

/** Fictitious content only: no fetch, no credentials, no API base URL. */
export default function SyntheticWorkspaceProvider({ children, role = null }: { children: ReactNode; role?: IdealRole | null }) {
  const selectedRole = role ?? "LEADER";
  const client = createIdealClient("storybook-synthetic");
  const live: LiveApi = {
    client,
    mutate: createMutator("storybook-synthetic"),
    scopeId: "synthetic/clinical-pharmacy",
    role: selectedRole,
    personId: `synthetic-${selectedRole.toLowerCase()}`,
    publication,
    selectedCaseId: null,
    selectedPersonId: null,
    isSynthetic: true,
    publicationOf: (id) => id === publication.publication_id ? publication : undefined,
    people: [
      { person_id: "synthetic-admin", name: "佐藤 美咲" },
      { person_id: "synthetic-leader", name: "鈴木 悠斗" },
      { person_id: "synthetic-pharmacist", name: "高橋 葵" },
    ],
    nameOf: (person) => ({ "synthetic-admin": "佐藤 美咲", "synthetic-leader": "鈴木 悠斗", "synthetic-pharmacist": "高橋 葵" })[person] ?? person,
    refresh: async () => {},
  };
  const model = SYNTHETIC_SOURCE.model && {
    ...SYNTHETIC_SOURCE.model,
    shell: { ...SYNTHETIC_SOURCE.model.shell, nav: WORKSPACE_NAV },
  };
  return <WorkspaceContext.Provider value={{ ...SYNTHETIC_SOURCE, source: "api", role: selectedRole, live, model }}>{children}</WorkspaceContext.Provider>;
}
