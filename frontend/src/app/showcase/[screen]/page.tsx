import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IdealWorkspace from "@/components/ideal/IdealWorkspace";
import SyntheticWorkspaceProvider from "@/ideal/providers/SyntheticWorkspaceProvider";
import type { IdealScreen } from "@/ideal/types";
import { showcaseEnabled } from "@/lib/featureFlags";

const screens: IdealScreen[] = ["home", "schedule", "plan", "operations", "requests", "people", "governance", "settings"];

// Decided per request from the server environment, so production (flag unset) answers 404.
export const dynamic = "force-dynamic";

export default async function ShowcasePage({ params }: { params: Promise<{ screen: string }> }) {
  if (!showcaseEnabled()) notFound();
  const { screen } = await params;
  if (!screens.includes(screen as IdealScreen)) notFound();
  return <SyntheticWorkspaceProvider><IdealWorkspace initialScreen={screen as IdealScreen} showLabControls /></SyntheticWorkspaceProvider>;
}

export const metadata: Metadata = {
  title: "理想UIショーケース",
  description: "合成データだけで操作できるPharmShiftMaker理想UI v1",
};
