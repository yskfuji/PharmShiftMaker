import { notFound, redirect } from "next/navigation";
import { previewEnabled } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";

export default function PreviewIndexPage() {
  if (!previewEnabled()) notFound();
  redirect("/preview/home");
}
