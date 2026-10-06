import { OPEN_CASE } from "@/ideal/live/format";
import type { ScheduleChangeCase } from "@/ideal/types";
import CaseList from "../../shared/changeCases/CaseList";
import CaseNotice from "../../shared/changeCases/CaseNotice";
import NewCaseForm from "../../shared/changeCases/NewCaseForm";
import type { RouteContext } from "../../shell/routeTypes";
import { operationVerbs } from "./verbs";

/** Same-day operations: the open cases to decide, and absences recorded by a planner. */
export default function CasesView({ data, ctx }: { data: ScheduleChangeCase[]; ctx: RouteContext }) {
  const open = data.filter((c) => OPEN_CASE.includes(c.status));
  return <div className="ideal-stack">
    <CaseNotice>
      <section className="ideal-panel" aria-labelledby="open-cases-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">判断が必要</span><h2 id="open-cases-title">進行中のケース</h2></div></div>
        <CaseList list={open} selectedCaseId={ctx.selectedCaseId} verbs={Object.fromEntries(open.map((c) => [c.case_id, operationVerbs(c, ctx.scope.person_id)]))} />
      </section>
      <section className="ideal-panel" aria-labelledby="record-absence-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">{ctx.publication ? `公開版 v${ctx.publication.version} の勤務から選ぶ` : "公開版 —"}</span><h2 id="record-absence-title">欠勤を記録して代わりを決める</h2></div></div>
        <NewCaseForm duties={ctx.publication?.assignments ?? []} kinds={["ABSENCE"]} />
      </section>
    </CaseNotice>
  </div>;
}
