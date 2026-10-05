import type { ScheduleChangeCase } from "@/ideal/types";
import CaseNotice from "../../shared/changeCases/CaseNotice";
import type { RouteContext } from "../../shell/routeTypes";
import { NewRequest, RelatedCases, RequestsIntro } from "../RequestSections";

/** Exchanges: the counterpart's consent and the planner's decision, and a new exchange. */
export default function SwapView({ data, ctx }: { data: ScheduleChangeCase[]; ctx: RouteContext }) {
  return <div className="ideal-stack">
    <CaseNotice>
      <RequestsIntro eyebrow="勤務交換" title="相手の同意と責任者判断" />
      <RelatedCases cases={data} ctx={ctx} />
      <NewRequest summary="新しい勤務交換を依頼" kinds={["SWAP"]} ctx={ctx} />
    </CaseNotice>
  </div>;
}
