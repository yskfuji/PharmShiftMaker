import type { ReactNode } from "react";
import type { ScheduleChangeCase } from "@/ideal/types";
import CaseList from "../shared/changeCases/CaseList";
import { involves } from "../shared/changeCases/cases";
import NewCaseForm from "../shared/changeCases/NewCaseForm";
import { routeOf, type RouteContext } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import { requestVerbs } from "./verbs";

/** Says what the route is for, and where leave is requested instead. */
export function RequestsIntro({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <section className="ideal-toolbar"><div><span className="ideal-eyebrow">{eyebrow}</span><h2>{title}</h2>
    <p>希望休・年休の申請は、<WorkspaceLink className="ideal-inline-link" route={routeOf("requests/leave").route}>休暇の画面</WorkspaceLink>で行います。</p></div></section>;
}

/** The viewer's own cases and the consents asked of them. A planner receives every case of
 * the scope, so theirs are picked out; a pharmacist receives only their own. */
export function RelatedCases({ cases, ctx }: { cases: ScheduleChangeCase[]; ctx: RouteContext }) {
  const me = ctx.scope.person_id;
  const list = cases.filter((c) => ctx.role === "PHARMACIST" || involves(c, me));
  return <section className="ideal-panel" aria-labelledby="my-cases-title">
    <div className="ideal-panel__head"><div><span className="ideal-eyebrow">あなたに関係するケース</span><h2 id="my-cases-title">申請中・同意の依頼</h2></div></div>
    <CaseList list={list} selectedCaseId={ctx.selectedCaseId} verbs={Object.fromEntries(list.map((c) => [c.case_id, requestVerbs(c, me, ctx.role)]))} />
  </section>;
}

/** A new case for one of the viewer's own published duties, closed until asked for. */
export function NewRequest({ summary, kinds, ctx }: { summary: ReactNode; kinds: Array<"ABSENCE" | "SWAP">; ctx: RouteContext }) {
  const own = (ctx.publication?.assignments ?? []).filter((d) => d.person_id === ctx.scope.person_id);
  return <details className="ideal-v3-disclosure"><summary>{summary}</summary>
    <section aria-labelledby="new-case-title"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">公開版 {ctx.publication ? `v${ctx.publication.version}` : "—"} の自分の勤務</span><h2 id="new-case-title">新しい申請</h2></div></div>
      <NewCaseForm duties={own} kinds={kinds} />
    </section>
  </details>;
}
