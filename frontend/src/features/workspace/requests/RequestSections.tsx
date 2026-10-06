import type { ScheduleChangeCase } from "@/ideal/types";
import CaseList from "../shared/changeCases/CaseList";
import { involves } from "../shared/changeCases/cases";
import NewCaseForm from "../shared/changeCases/NewCaseForm";
import TaskDisclosure from "../shared/TaskDisclosure";
import TaskJump from "../shared/TaskJump";
import { routeOf, type RouteContext } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import { requestVerbs } from "./verbs";

/** The `id` of the task that opens a new case: the first card of the route leads to it. */
const NEW_REQUEST_TASK = "requests-task-new";

/**
 * The first card of a route of cases: what the route is for, and the way to its new case.
 * `jump` names that way in words of its own (a task's summary is not repeated). `leave`
 * adds where leave is requested instead, for the route a person may come to looking for it.
 */
export function RequestsIntro({ title, lead, jump, leave = false }: { title: string; lead: string; jump: string; leave?: boolean }) {
  return <section className="ideal-toolbar">
    <div>
      <h2>{title}</h2>
      <p>{lead}</p>
      {leave && <p className="ideal-v3-requests-pointer">希望休・年休の申請は、<WorkspaceLink className="ideal-inline-link" route={routeOf("requests/leave").route}>休暇の画面</WorkspaceLink>で行います。</p>}
    </div>
    <div className="ideal-v3-requests-jumps"><TaskJump target={NEW_REQUEST_TASK}>{jump}</TaskJump></div>
  </section>;
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

/** A new case for one of the viewer's own published duties: the route's task, closed until
 * asked for. Its tone and its line of description are fixed where the route declares it. */
export function NewRequest({ summary, hint, kinds, ctx }: { summary: string; hint: string; kinds: Array<"ABSENCE" | "SWAP">; ctx: RouteContext }) {
  const own = (ctx.publication?.assignments ?? []).filter((d) => d.person_id === ctx.scope.person_id);
  return <TaskDisclosure id={NEW_REQUEST_TASK} tone="primary" summary={summary} hint={hint}>
    <section aria-labelledby="new-case-title"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">公開版 {ctx.publication ? `v${ctx.publication.version}` : "—"} の自分の勤務</span><h2 id="new-case-title">新しい申請</h2></div></div>
      <NewCaseForm duties={own} kinds={kinds} />
    </section>
  </TaskDisclosure>;
}
