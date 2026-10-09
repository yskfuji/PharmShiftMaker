import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkspaceRoutePage, { type WorkspaceSearch } from "@/features/workspace/shell/WorkspaceRoutePage";
import { screenMeta } from "@/ideal/ui/atoms";
import type { IdealScreen } from "@/ideal/types";
import { isWorkspaceView, workspaceViews } from "@/ideal/views";
import { idealUiEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

/** A screen of the contract. Own keys only: "constructor" or "__proto__" in the address is
 * a key every object answers to, and is no screen. */
const isScreen = (screen: string): screen is IdealScreen => Object.hasOwn(screenMeta, screen);

// One view of a workspace screen. Only a screen and a view of the generated route contract
// exist; the route itself is rendered by WorkspaceRoutePage from its own definition.
export default async function WorkspaceViewPage({ params, searchParams }: {
  params: Promise<{ screen: string; view: string }>;
  searchParams: Promise<WorkspaceSearch>;
}) {
  if (!idealUiEnabled()) notFound();
  const { screen, view } = await params;
  if (!isScreen(screen) || !isWorkspaceView(screen, view)) notFound();
  return <WorkspaceRoutePage screen={screen} view={view} search={await searchParams} />;
}

export async function generateMetadata({ params }: { params: Promise<{ screen: string; view: string }> }): Promise<Metadata> {
  const { screen, view } = await params;
  if (!isScreen(screen) || !Object.hasOwn(workspaceViews, screen)) return { title: "見つかりません" };
  const item = workspaceViews[screen]?.find((candidate) => candidate.key === view);
  return { title: item ? `${item.label} · ${screenMeta[screen].label}` : "見つかりません" };
}
