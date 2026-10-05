import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkspaceRoutePage, { type WorkspaceSearch } from "@/features/workspace/shell/WorkspaceRoutePage";
import { screenMeta } from "@/ideal/ui/atoms";
import type { IdealScreen } from "@/ideal/types";
import { idealUiEnabled } from "@/lib/featureFlags";

const screens = Object.keys(screenMeta) as IdealScreen[];

// The ideal UI as the production entry, only with IDEAL_UI=1 (read per request from the
// server environment; off, this route does not exist). Sign-in is enforced by the proxy
// (/workspace is protected) and every read and change by the API. The route itself (its
// context, its role check, its own read and its view) is rendered by WorkspaceRoutePage;
// which view a screen opens without one depends on the viewer's role and is decided there.
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<WorkspaceSearch>;
}) {
  if (!idealUiEnabled()) notFound();
  const { screen } = await params;
  if (!screens.includes(screen as IdealScreen)) notFound();
  return <WorkspaceRoutePage screen={screen as IdealScreen} search={await searchParams} />;
}

export async function generateMetadata({ params }: { params: Promise<{ screen: string }> }): Promise<Metadata> {
  const { screen } = await params;
  // The same list as the page: a segment such as "constructor" is no screen, although every
  // object answers to that key.
  return { title: screens.includes(screen as IdealScreen) ? screenMeta[screen as IdealScreen].label : "見つかりません" };
}
