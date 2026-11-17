import { notFound, redirect } from "next/navigation";
import { idealUiEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

export default function WorkspaceIndexPage() {
  if (!idealUiEnabled()) notFound();
  redirect("/workspace/home");
}
