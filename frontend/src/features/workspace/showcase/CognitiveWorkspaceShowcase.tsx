"use client";

import WorkspaceShell from "../shell/WorkspaceShell";
import WorkspaceContent from "../shell/WorkspaceContent";
import SyntheticWorkspaceProvider from "@/ideal/providers/SyntheticWorkspaceProvider";
import { EmptyState, LoadingState, ProblemState } from "@/ideal/screens/shared";
import { syntheticProblems } from "@/ideal/synthetic";
import type { InitialWorkspacePayload } from "@/ideal/providers/initial";
import type { IdealRole, IdealScreen, ShowcaseState } from "@/ideal/types";

const initialFor = (role: IdealRole): InitialWorkspacePayload => ({
  observedAt: "2026-10-12T08:16:00+09:00",
  requestedPeriod: "2026-10",
  selectedPublicationId: "synthetic-publication-12",
  selectedCaseId: null,
  selectedPersonId: null,
  viewerName: role === "ADMIN" ? "佐藤 美咲" : role === "LEADER" ? "鈴木 悠斗" : "高橋 葵",
  scopes: [{ scope_id: "synthetic/clinical-pharmacy", display_name: "東都医療センター · 薬剤部", person_id: `synthetic-${role.toLowerCase()}`, role, input_revision: 12 }],
  scope: { scope_id: "synthetic/clinical-pharmacy", display_name: "東都医療センター · 薬剤部", person_id: `synthetic-${role.toLowerCase()}`, role, input_revision: 12 },
  selectionRequired: false,
  problem: null,
  publications: [{ publication_id: "synthetic-publication-12", version: 12, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [], validation_status: "valid" }],
  names: {}, calendar: null, dashboard: null, daily: null, stability: null,
  notifications: [{ event_id: "synthetic-notice-1", category: "schedule", kind: "公開版が更新されました", publication_id: "synthetic-publication-12", version: 12, read: false, created_at: "2026-10-12T07:42:00+09:00" }],
  partialProblems: [],
});

export default function CognitiveWorkspaceShowcase({ screen = "home", view, role = "LEADER", state = "ready" }: { screen?: IdealScreen; view?: string; role?: IdealRole; state?: ShowcaseState }) {
  const initial = initialFor(role);
  return <WorkspaceShell initial={initial} screen={screen} view={view}>
    <SyntheticWorkspaceProvider role={role}>
      {state === "ready" ? <WorkspaceContent screen={screen} view={view} />
        : state === "empty" ? <EmptyState screen={screen} />
          : state === "loading" ? <LoadingState />
            : <ProblemState problem={syntheticProblems[state]} />}
    </SyntheticWorkspaceProvider>
  </WorkspaceShell>;
}
