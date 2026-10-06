import type { ScheduleChangeCase } from "@/ideal/types";
import CaseNotice from "../../shared/changeCases/CaseNotice";
import type { RouteContext } from "../../shell/routeTypes";
import { NewRequest, RelatedCases, RequestsIntro } from "../RequestSections";

/** Your own absences and exchanges: where each stands and what is asked of you, and a new
 * one. Leave is requested on another route, which the first card points to. */
export default function MineView({ data, ctx }: { data: ScheduleChangeCase[]; ctx: RouteContext }) {
  return <div className="ideal-stack">
    <CaseNotice>
      <RequestsIntro title="申請の状態と新しい申請" lead="欠勤と勤務交換について、あなたが出した申請と、あなたに求められている同意の状態を確認します。" jump="新しく申請する" leave />
      <RelatedCases cases={data} ctx={ctx} />
      <NewRequest summary="新しい欠勤・交換を申請" hint="公開された自分の勤務を選び、欠勤か交換かと、その理由を申請します。" kinds={["ABSENCE", "SWAP"]} ctx={ctx} />
    </CaseNotice>
  </div>;
}
