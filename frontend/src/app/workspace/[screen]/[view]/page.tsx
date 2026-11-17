import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ApiWorkspaceProvider from "@/ideal/providers/ApiWorkspaceProvider";
import WorkspaceContent from "@/features/workspace/shell/WorkspaceContent";
import WorkspaceShell from "@/features/workspace/shell/WorkspaceShell";
import { screenMeta } from "@/ideal/screens/shared";
import type { IdealScreen } from "@/ideal/types";
import { loadInitialWorkspace } from "@/ideal/api/serverInitial";
import { isWorkspaceView, workspaceViews } from "@/ideal/views";
import { idealUiEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

export default async function WorkspaceViewPage({ params, searchParams }: {
  params: Promise<{ screen: string; view: string }>;
  searchParams: Promise<{ scope?: string; period?: string; publication?: string; case?: string; person?: string }>;
}) {
  if (!idealUiEnabled()) notFound();
  const { screen, view } = await params;
  if (!(screen in screenMeta) || !isWorkspaceView(screen as IdealScreen, view)) notFound();
  const { scope, period, publication, case: caseId, person } = await searchParams;
  const privacyPurpose = screen === "governance" && view === "privacy";
  const initial = await loadInitialWorkspace(scope, screen as IdealScreen, { period, publicationId: publication, caseId, personId: person }, view);
  return <WorkspaceShell initial={initial} screen={screen as IdealScreen} view={view} routeContext={{ case: initial.selectedCaseId ?? undefined, person: initial.selectedPersonId ?? undefined }}>
    <ApiWorkspaceProvider scopeId={scope} period={initial.requestedPeriod} publicationId={initial.selectedPublicationId ?? undefined} caseId={initial.selectedCaseId ?? undefined} personId={initial.selectedPersonId ?? undefined} privacyPurpose={privacyPurpose} rosterPurpose={screen === "people"} initial={initial}><WorkspaceContent screen={screen as IdealScreen} view={view} /></ApiWorkspaceProvider>
  </WorkspaceShell>;
}

export async function generateMetadata({ params }: { params: Promise<{ screen: string; view: string }> }): Promise<Metadata> {
  const { screen, view } = await params;
  const item = workspaceViews[screen as IdealScreen]?.find((candidate) => candidate.key === view);
  return { title: item ? `${item.label} · ${screenMeta[screen as IdealScreen]?.label ?? "PharmShiftMaker"}` : "見つかりません" };
}
