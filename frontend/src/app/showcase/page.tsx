import { notFound, redirect } from "next/navigation";
import { showcaseEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

export default function ShowcaseIndexPage() {
  if (!showcaseEnabled()) notFound();
  redirect("/showcase/home");
}
