import type { AuditTimelinePage } from "@/ideal/types";
import AuditTimeline from "./AuditTimeline";

/** The anonymised audit timeline. The other governance routes are the tabs of the shell
 * above it; the view does not repeat them. */
export default function AuditView({ data }: { data: AuditTimelinePage }) {
  return <div className="ideal-stack">
    <AuditTimeline first={data} />
  </div>;
}
