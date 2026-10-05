import type { ScheduleChangeCase } from "@/ideal/types";
import CaseNotice from "../../shared/changeCases/CaseNotice";
import type { RouteContext } from "../../shell/routeTypes";
import { NewRequest, RelatedCases, RequestsIntro } from "../RequestSections";

/** Your own absences and exchanges: their history and the next step, and a new one. */
export default function MineView({ data, ctx }: { data: ScheduleChangeCase[]; ctx: RouteContext }) {
  return <div className="ideal-stack">
    <CaseNotice>
      <RequestsIntro eyebrow="自分の申請" title="履歴と次の操作" />
      <RelatedCases cases={data} ctx={ctx} />
      <NewRequest summary="新しい欠勤・交換を申請" kinds={["ABSENCE", "SWAP"]} ctx={ctx} />
    </CaseNotice>
  </div>;
}
