import { ChevronRight } from "lucide-react";
import type { AuditTimelinePage } from "@/ideal/types";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import AuditTimeline from "./AuditTimeline";

const RELATED = [
  { route: routeOf("governance/privacy").route, title: "個人情報", body: "開示・訂正・消去とコピーの管理" },
  { route: routeOf("governance/recovery").route, title: "復旧", body: "復元と保護状態の確認" },
  { route: routeOf("governance/actuals").route, title: "実績照合", body: "取込・差分・確定の記録" },
];

/** The anonymised audit timeline, beside the other governance routes. */
export default function AuditView({ data }: { data: AuditTimelinePage }) {
  return <div className="ideal-stack">
    <div className="ideal-grid ideal-grid--3">
      {RELATED.map((item) =>
        <article className="ideal-governance-card" key={item.route}><h2>{item.title}</h2><p>{item.body}</p><WorkspaceLink className="ideal-link ideal-link--target" route={item.route}>{item.title}を開く <ChevronRight aria-hidden="true" /></WorkspaceLink></article>)}
    </div>
    <AuditTimeline first={data} />
  </div>;
}
