import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import TaskDisclosure from "../../shared/TaskDisclosure";
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

/**
 * Leave: what stands now (balances, the five-day obligation, the viewer's requests), what
 * can be done next, and the history. A form opens only from "next"; every change is
 * confirmed in place. Planners are also given the requests awaiting confirmation; an
 * administrator the ledger tasks, whose records are read when a task is opened.
 */
export default function LeaveView({ data, ctx }: { data: LeaveData; ctx: RouteContext }) {
  const person = (personId: string) => nameOf(ctx, personId);
  const planner = ctx.role !== "PHARMACIST";
  const own = data.requests.filter((row) => row.person_id === ctx.scope.person_id && row.status !== "CANCELLED");
  const waiting = data.requests.filter((row) => row.status !== "APPROVED" && row.status !== "CANCELLED").length;
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><span className="ideal-eyebrow">休暇</span><h2>残高・申請の状態と次の操作</h2><p>公休の希望と年休の請求を分けて記録します。年休は、確認のあと計画入力へ反映して初めて予約として扱われます。</p></div>
      <StatusPill tone={waiting ? "warn" : "good"}>{waiting ? `確認が済んでいない申請 ${waiting}件` : "確認待ちの申請なし"}</StatusPill>
    </section>
    <section className="ideal-panel" aria-labelledby="leave-current-title">
      <h2 id="leave-current-title">現在の状態</h2>
      <LeaveCurrent ledger={data.ledger} requests={own} person={person} planner={planner} />
    </section>
    <section className="ideal-panel" aria-labelledby="leave-next-title">
      <h2 id="leave-next-title">次の操作</h2>
      <div className="ideal-v3-record">
        <section aria-labelledby="leave-next-own-title">
          <h3 id="leave-next-own-title" className="ideal-v3-heading">本人の申請</h3>
          <TaskDisclosure summary="公休の希望を出す"><HolidayWish /></TaskDisclosure>
          <TaskDisclosure summary="年次有給休暇を請求する（日・半日・時間）"><PaidLeaveClaim sources={data.sources} /></TaskDisclosure>
          <TaskDisclosure summary="自分の申請を取り下げる"><WithdrawRequest requests={data.requests} /></TaskDisclosure>
        </section>
        {planner && <section aria-labelledby="leave-next-review-title">
          <h3 id="leave-next-review-title" className="ideal-v3-heading">申請の確認（管理者・責任者）</h3>
          <TaskDisclosure summary={`申請を確認する（確認待ち ${waiting}件）`}><ReviewQueue requests={data.requests} /></TaskDisclosure>
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
      <div className="ideal-v3-record">
        <section aria-labelledby="leave-history-requests-title">
          <h3 id="leave-history-requests-title" className="ideal-v3-heading">申請の一覧</h3>
          <p className="ideal-note">{planner ? "この部署の全員の申請です。" : "あなたの申請です。"}取り下げた申請を含みます。各申請の現在の版を表示します。</p>
          {data.requests.length ? <RequestTable label="申請の一覧（現在の版）" rows={data.requests} person={person} /> : <p className="ideal-note">申請の記録はありません。</p>}
        </section>
        <section aria-labelledby="leave-history-ledger-title">
          <h3 id="leave-history-ledger-title" className="ideal-v3-heading">年休台帳の過去時点と訂正</h3>
          <TaskDisclosure summary="過去時点の年休台帳と訂正履歴を照会する"><LedgerAsOf /></TaskDisclosure>
        </section>
      </div>
    </section>
  </div>;
}
