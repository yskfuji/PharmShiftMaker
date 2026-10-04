import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IdealWorkspace from "@/components/ideal/IdealWorkspace";
import ApiWorkspaceProvider from "@/ideal/providers/ApiWorkspaceProvider";
import type { IdealScreen } from "@/ideal/types";
import { previewEnabled } from "@/lib/featureFlags";

// Every ideal screen, read and changed through the API (the server authorizes each call).
const screens: IdealScreen[] = ["home", "schedule", "plan", "operations", "requests", "people", "governance", "settings"];

// Decided per request from the server environment; production (flag unset) answers 404.
// Sign-in is enforced by the proxy (/preview is protected) and every read by the API.
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params, searchParams }: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  if (!previewEnabled()) notFound();
  const { screen } = await params;
  if (!screens.includes(screen as IdealScreen)) notFound();
  const { scope } = await searchParams;
  return <ApiWorkspaceProvider scopeId={scope}><IdealWorkspace initialScreen={screen as IdealScreen} /></ApiWorkspaceProvider>;
}

export const metadata: Metadata = {
  title: "理想UI プレビュー",
  description: "自分の所属の業務を、理想UIで扱う候補画面（IDEAL_PREVIEW=1 のときだけ）",
};
