import type { ScheduleChangeCase } from "@/ideal/types";
import CaseNotice from "../../shared/changeCases/CaseNotice";
import type { RouteContext } from "../../shell/routeTypes";
import { NewRequest, RelatedCases, RequestsIntro } from "../RequestSections";

/** Exchanges: the counterpart's consent and the planner's decision, and a new exchange. */
export default function SwapView({ data, ctx }: { data: ScheduleChangeCase[]; ctx: RouteContext }) {
  return <div className="ideal-stack">
    <CaseNotice>
      <RequestsIntro title="相手の同意と責任者判断" lead="勤務の交換は、相手の同意のあと責任者が判断します。進み具合と、あなたに求められた同意を確認します。" jump="交換を依頼する" />
      <RelatedCases cases={data} ctx={ctx} />
      <NewRequest summary="新しい勤務交換を依頼" hint="公開された自分の勤務と交換の相手を選び、理由を添えて依頼します。" kinds={["SWAP"]} ctx={ctx} />
    </CaseNotice>
  </div>;
}
