import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import TaskDisclosure from "../../shared/TaskDisclosure";
import TaskJump from "../../shared/TaskJump";
import { nameOf, routeOf, type RouteContext } from "../../shell/routeTypes";
import type { DeclarationContext, DeclarationRow } from "../api";
import DeclarationEditor from "./DeclarationEditor";
import { ACTIVITY_LABEL, STATUS_LABEL, declarationNames, periodText, type DeclarationNames } from "./model";
import ReviewDeclaration from "./ReviewDeclaration";
import WithdrawDeclaration from "./WithdrawDeclaration";
import TableScrollCue from "../../shared/TableScrollCue";

const tone = (status: string) => (status === "REVIEWED" ? "good" : status === "WITHDRAWN" ? "neutral" : "warn");

/** The `id`s of the tasks the header leads to: the registration, and the comparison that
 * answers the header's count. */
const DECLARE_TASK = "outside-task-declare";
const REVIEW_TASK = "outside-task-review";

/** A table of declarations: whose, its status, where, what kind, for when and the version.
 * The status follows the person, so that it is in view at phone width before the table is
 * scrolled. */
function Declarations({ label, rows, names }: { label: string; rows: DeclarationRow[]; names: DeclarationNames }) {
  return <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">本人</th><th scope="col">状態</th><th scope="col">雇用主・事業場</th><th scope="col">区分</th><th scope="col">適用期間（日本時間）</th><th scope="col">版</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.entity_id}>
      <th scope="row">{names.person(row.payload.person_id)}</th>
      <td><StatusPill tone={tone(row.payload.status)}>{STATUS_LABEL[row.payload.status] ?? row.payload.status}</StatusPill></td>
      <td>{names.employer(row.payload.employer_id)}・{names.site(row.payload.establishment_id)}</td>
      <td>{ACTIVITY_LABEL[row.payload.activity] ?? row.payload.activity}</td>
      <td>{periodText(row.payload)}</td>
      <td>第{row.revision}版</td>
    </tr>)}</tbody>
  </table></div></>;
}

/**
 * Outside work: the declarations as they stand, what can be done next, and the history.
 * A form opens only from "next"; every change is confirmed in place. An administrator is
 * given everyone's declarations and the comparison; everyone else their own.
 *
 * The declarations that are not withdrawn stand under "now"; the history holds the
 * withdrawn ones, so no row is shown twice. A row is placed by the status the server
 * returned. The order, the tone and the one-line description of each task are fixed here:
 * registering is what the route points a person at, the comparison what it points an
 * administrator at (the header's count leads to it). No task is marked as one that cannot
 * be undone: a withdrawal changes the status only, and the earlier versions stay.
 */
export default function OutsideView({ data, ctx }: { data: DeclarationContext; ctx: RouteContext }) {
  const admin = ctx.role === "ADMIN";
  const names = declarationNames(data, (personId) => nameOf(ctx, personId));
  const current = data.declarations.filter((row) => row.payload.status !== "WITHDRAWN");
  const withdrawn = data.declarations.filter((row) => row.payload.status === "WITHDRAWN");
  const waiting = current.filter((row) => row.payload.status !== "REVIEWED").length;
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div>
        <h2>申告の状態と次の操作</h2>
        <p>本人の申告と、管理者による他社資料との照合を分けて記録します。</p>
        <div className="ideal-v3-requests-jumps"><TaskJump target={DECLARE_TASK}>申告する</TaskJump></div>
      </div>
      <div className="ideal-v3-badge-action">
        <StatusPill tone={waiting ? "warn" : "good"}>{waiting ? `照合が済んでいない申告 ${waiting}件` : "照合待ちの申告なし"}</StatusPill>
        {admin && waiting > 0 && <TaskJump target={REVIEW_TASK}>照合する</TaskJump>}
        {!admin && waiting > 0 && <p className="ideal-note ideal-v3-requests-waiting">管理者が、他社の資料と照らし合わせるのを待っています。いま、あなたが行う操作はありません。</p>}
      </div>
    </section>
    <section className="ideal-panel ideal-v3-requests-tables" aria-labelledby="outside-current-title">
      <h2 id="outside-current-title">現在の状態</h2>
      <p>{admin ? "この部署の全員の申告です。" : "あなたの申告です。"}取り下げた申告は「履歴」にあります。</p>
      {current.length ? <Declarations label="現在の申告" rows={current} names={names} /> : <p className="ideal-note">現在の申告はありません。</p>}
      {current.filter((row) => !row.actions.change.allowed).map((row) => <p className="ideal-v3-callout" key={row.entity_id}>{names.employer(row.payload.employer_id)}（{periodText(row.payload)}）：{row.actions.change.refusal}</p>)}
    </section>
    <section className="ideal-panel" aria-labelledby="outside-next-title">
      <h2 id="outside-next-title">次の操作</h2>
      <div className="ideal-v3-record">
        <section aria-labelledby="outside-next-declare-title">
          <h3 id="outside-next-declare-title" className="ideal-v3-heading">申告を出す・直す</h3>
          <div className="ideal-v3-task-list">
            <TaskDisclosure id={DECLARE_TASK} tone={admin ? "routine" : "primary"} summary="申告を登録・訂正する" hint="他の雇用主や活動先での勤務を申告・訂正します。"><DeclarationEditor context={data} /></TaskDisclosure>
            <TaskDisclosure summary="申告を取り下げる" hint="状態だけを「取下げ済み」にします。以前の版は残ります。取り下げた後も、同じ申告を訂正して出し直すことや、新しい申告を登録することができます。"><WithdrawDeclaration context={data} /></TaskDisclosure>
          </div>
        </section>
        {admin && <section aria-labelledby="outside-next-review-title">
          <h3 id="outside-next-review-title" className="ideal-v3-heading">管理者の照合</h3>
          <div className="ideal-v3-task-list">
            <TaskDisclosure id={REVIEW_TASK} tone="primary" summary="申告を他社資料と照合する（管理者）" hint="申告の合計を他社の資料と比べ、結果を根拠とともに記録します。"><ReviewDeclaration context={data} /></TaskDisclosure>
          </div>
        </section>}
      </div>
    </section>
    <section className="ideal-panel ideal-v3-requests-tables" aria-labelledby="outside-history-title">
      <h2 id="outside-history-title">履歴</h2>
      {withdrawn.length ? <>
        <p>取り下げた申告の、現在の版です。取り下げていない申告は、上の「現在の状態」に表示しています。</p>
        <Declarations label="取り下げた申告（現在の版）" rows={withdrawn} names={names} />
      </> : <p className="ideal-note">{data.declarations.length ? "取り下げた申告はありません。取り下げていない申告は、上の「現在の状態」に表示しています。" : "申告の記録はありません。"}</p>}
      <dl className="ideal-definition-list">
        <div><dt>以前の版</dt><dd>この画面に表示できるのは現在の版の内容だけで、以前の版の内容は表示できません。</dd></div>
        <div><dt>操作の記録</dt><dd>保存した時刻・操作した役割・版は、監査の履歴に残ります。{admin ? "" : "監査の履歴は管理者が確認できます。"}</dd></div>
      </dl>
      {admin && <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></div>}
    </section>
  </div>;
}
