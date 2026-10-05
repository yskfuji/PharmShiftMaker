import { notFound, redirect } from "next/navigation";
import { routeOf } from "@/features/workspace/shell/routeTypes";
import { idealUiEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

export default function WorkspaceIndexPage() {
  if (!idealUiEnabled()) notFound();
  redirect(routeOf("home/index").route);
}
