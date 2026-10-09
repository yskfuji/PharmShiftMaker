import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import TaskDisclosure from "../../shared/TaskDisclosure";
import TaskJump from "../../shared/TaskJump";
import { nameOf, routeOf, type RouteContext } from "../../shell/routeTypes";
import type { LeaveRequestRow } from "../api";
import LeaveAdmin from "./admin/LeaveAdmin";
import HolidayWish from "./HolidayWish";
import LeaveCurrent, { RequestTable } from "./LeaveCurrent";
import LedgerAsOf from "./LedgerAsOf";
import type { LedgerState, OwnSources } from "./model";
import PaidLeaveClaim from "./PaidLeaveClaim";
import ReviewQueue from "./ReviewQueue";
import WithdrawRequest from "./WithdrawRequest";

export type LeaveData = { requests: LeaveRequestRow[]; ledger: LedgerState | null; sources: OwnSources | null };

/** The `id`s of the tasks the header leads to: the two requests, and the confirmation that
 * answers the header's count. */
const WISH_TASK = "leave-task-wish";
const CLAIM_TASK = "leave-task-claim";
const REVIEW_TASK = "leave-task-review";

/**
 * Leave: what stands now (balances, the five-day obligation, the viewer's requests), what
 * can be done next, and the history. A form opens only from "next"; every change is
 * confirmed in place. Planners are also given the requests awaiting confirmation; an
 * administrator the ledger tasks, whose records are read when a task is opened.
 *
 * The header leads to the two requests, and, for those who may confirm, from its count to
 * the confirmation. The order, the tone and the one-line description of each task are fixed
 * here and never derived from the data.
 *
 * The viewer's requests that are not withdrawn stand under "now". The history holds what
 * "now" does not show: for a pharmacist the withdrawn requests, for a planner the requests
 * of the whole department. A row is placed by the status the server returned; nothing is
 * judged here. A row a pharmacist's read returns that is neither their own open request nor
 * a withdrawn one is not called withdrawn: it is listed apart, under a heading that claims
 * nothing about it.
 */
export default function LeaveView({ data, ctx }: { data: LeaveData; ctx: RouteContext }) {
  const person = (personId: string) => nameOf(ctx, personId);
  const planner = ctx.role !== "PHARMACIST";
  const own = data.requests.filter((row) => row.person_id === ctx.scope.person_id && row.status !== "CANCELLED");
  const waiting = data.requests.filter((row) => row.status !== "APPROVED" && row.status !== "CANCELLED").length;
  // The pharmacist's history, by the state the server returned: the withdrawn requests, and
  // apart from them whatever else "now" does not show.
  const withdrawn = data.requests.filter((row) => row.status === "CANCELLED");
  const others = data.requests.filter((row) => row.status !== "CANCELLED" && !own.includes(row));
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div>
        <h2>残高・申請の状態と次の操作</h2>
        <p>公休の希望と年休の請求を分けて記録します。年休は、管理者・責任者が確認し、計画に取り込んで初めて予約として扱われます。</p>
        <div className="ideal-v3-requests-jumps"><TaskJump target={WISH_TASK}>公休を希望する</TaskJump><TaskJump target={CLAIM_TASK}>年休を請求する</TaskJump></div>
      </div>
      <div className="ideal-v3-badge-action">
        <StatusPill tone={waiting ? "warn" : "good"}>{waiting ? `確認が済んでいない申請 ${waiting}件` : "確認待ちの申請なし"}</StatusPill>
        {planner && waiting > 0 && <TaskJump target={REVIEW_TASK}>確認する</TaskJump>}
        {!planner && waiting > 0 && <TaskJump target="leave-own-title">申請を見る</TaskJump>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="leave-current-title">
      <h2 id="leave-current-title">現在の状態</h2>
      <LeaveCurrent ledger={data.ledger} requests={own} person={person} planner={planner} me={ctx.scope.person_id} />
    </section>
    <section className="ideal-panel" aria-labelledby="leave-next-title">
      <h2 id="leave-next-title">次の操作</h2>
      <div className="ideal-v3-record">
        <section aria-labelledby="leave-next-own-title">
          <h3 id="leave-next-own-title" className="ideal-v3-heading">本人の申請</h3>
          <div className="ideal-v3-task-list">
            <TaskDisclosure id={WISH_TASK} summary="公休の希望を出す" hint="年休を使わずに、休みたい日時を希望します。"><HolidayWish /></TaskDisclosure>
            <TaskDisclosure id={CLAIM_TASK} summary="年次有給休暇を請求する（日・半日・時間）" hint="付与された年休を使う休暇を請求します。"><PaidLeaveClaim sources={data.sources} /></TaskDisclosure>
            <TaskDisclosure tone="danger" tag="取り消せません" summary="自分の申請を取り下げる" hint="出した希望や請求を取り下げます。取り下げた申請を元に戻す操作はありません。同じ日について、新しい希望や請求は出せます（確認は受け直しになります）。"><WithdrawRequest requests={data.requests} /></TaskDisclosure>
          </div>
        </section>
        {planner && <section aria-labelledby="leave-next-review-title">
          <h3 id="leave-next-review-title" className="ideal-v3-heading">申請の確認（管理者・責任者）</h3>
          <div className="ideal-v3-task-list">
            <TaskDisclosure id={REVIEW_TASK} tone="primary" summary={`申請を確認する（確認待ち ${waiting}件）`} hint="確認済みにするか相談を続けるかを、根拠とともに記録します。"><ReviewQueue requests={data.requests} /></TaskDisclosure>
          </div>
          <p className="ideal-note">確認した年休は、<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>計画の「前提・取込」</WorkspaceLink>で計画入力へ反映します。</p>
        </section>}
        {ctx.role === "ADMIN" && <section aria-labelledby="leave-next-ledger-title">
          <h3 id="leave-next-ledger-title" className="ideal-v3-heading">年休台帳の管理（管理者）</h3>
          <LeaveAdmin />
        </section>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="leave-history-title">
      <h2 id="leave-history-title">履歴</h2>
      <div className="ideal-v3-record ideal-v3-requests-tables">
        {planner ? <section aria-labelledby="leave-history-requests-title">
          <h3 id="leave-history-requests-title" className="ideal-v3-heading">この部署の申請の一覧</h3>
          <p className="ideal-note">この部署の全員の申請です。あなた自身の申請と、取り下げた申請を含みます。各申請の現在の版を表示します。</p>
          {data.requests.length ? <RequestTable label="申請の一覧（現在の版）" rows={data.requests} person={person} /> : <p className="ideal-note">申請の記録はありません。</p>}
        </section> : <section aria-labelledby="leave-history-requests-title">
          <h3 id="leave-history-requests-title" className="ideal-v3-heading">取り下げた申請</h3>
          {withdrawn.length ? <>
            <p className="ideal-note">取り下げた申請の、現在の版です。取り下げていない申請は、上の「あなたの申請」にあります。</p>
            <RequestTable label="取り下げた申請（現在の版）" rows={withdrawn} person={person} />
          </> : <p className="ideal-note">{data.requests.length ? "取り下げた申請はありません。取り下げていない申請は、上の「あなたの申請」にあります。" : "申請の記録はありません。"}</p>}
          {others.length > 0 && <>
            <h4 className="ideal-v3-heading">そのほかの申請</h4>
            <p className="ideal-note">上の「あなたの申請」にも、取り下げた申請にも当てはまらない申請です。各申請の現在の版を、サーバーが返した状態のまま表示します。</p>
            <RequestTable label="そのほかの申請（現在の版）" rows={others} person={person} />
          </>}
        </section>}
        <section aria-labelledby="leave-history-ledger-title">
          <h3 id="leave-history-ledger-title" className="ideal-v3-heading">年休台帳の過去時点と訂正</h3>
          <TaskDisclosure tone="info" summary="過去時点の年休台帳と訂正履歴を照会する" hint="指定した時点の残高と訂正の履歴を表示します。記録は変わりません。"><LedgerAsOf /></TaskDisclosure>
        </section>
      </div>
    </section>
  </div>;
}
