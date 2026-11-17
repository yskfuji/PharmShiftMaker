import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ApiWorkspaceProvider from "@/ideal/providers/ApiWorkspaceProvider";
import WorkspaceContent from "@/features/workspace/shell/WorkspaceContent";
import WorkspaceShell from "@/features/workspace/shell/WorkspaceShell";
import { screenMeta } from "@/ideal/screens/shared";
import type { IdealScreen } from "@/ideal/types";
import { loadInitialWorkspace } from "@/ideal/api/serverInitial";
import { idealUiEnabled } from "@/lib/featureFlags";

const screens = Object.keys(screenMeta) as IdealScreen[];

// The ideal UI as the production entry, only with IDEAL_UI=1 (read per request from the
// server environment; off, this route does not exist). Sign-in is enforced by the proxy
// (/workspace is protected) and every read and change by the API.
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ scope?: string; period?: string; publication?: string; case?: string; person?: string }>;
}) {
  if (!idealUiEnabled()) notFound();
  const { screen } = await params;
  if (!screens.includes(screen as IdealScreen)) notFound();
  const { scope, period, publication, case: caseId, person } = await searchParams;
  const initial = await loadInitialWorkspace(scope, screen as IdealScreen, { period, publicationId: publication, caseId, personId: person });
  return <WorkspaceShell initial={initial} screen={screen as IdealScreen} routeContext={{ case: initial.selectedCaseId ?? undefined, person: initial.selectedPersonId ?? undefined }}>
    <ApiWorkspaceProvider scopeId={scope} period={initial.requestedPeriod} publicationId={initial.selectedPublicationId ?? undefined} caseId={initial.selectedCaseId ?? undefined} personId={initial.selectedPersonId ?? undefined} rosterPurpose={screen === "people"} initial={initial}><WorkspaceContent screen={screen as IdealScreen} /></ApiWorkspaceProvider>
  </WorkspaceShell>;
}

export async function generateMetadata({ params }: { params: Promise<{ screen: string }> }): Promise<Metadata> {
  const { screen } = await params;
  return { title: screenMeta[screen as IdealScreen]?.label ?? "見つかりません" };
}
