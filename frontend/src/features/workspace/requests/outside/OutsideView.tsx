import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import TaskDisclosure from "../../shared/TaskDisclosure";
import { nameOf, routeOf, type RouteContext } from "../../shell/routeTypes";
import type { DeclarationContext, DeclarationRow } from "../api";
import DeclarationEditor from "./DeclarationEditor";
import { ACTIVITY_LABEL, STATUS_LABEL, declarationNames, periodText, type DeclarationNames } from "./model";
import ReviewDeclaration from "./ReviewDeclaration";
import WithdrawDeclaration from "./WithdrawDeclaration";

const tone = (status: string) => (status === "REVIEWED" ? "good" : status === "WITHDRAWN" ? "neutral" : "warn");

function Declarations({ label, rows, names }: { label: string; rows: DeclarationRow[]; names: DeclarationNames }) {
  return <div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">本人</th><th scope="col">雇用主・事業場</th><th scope="col">区分</th><th scope="col">適用期間（日本時間）</th><th scope="col">状態</th><th scope="col">版</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.entity_id}>
      <th scope="row">{names.person(row.payload.person_id)}</th>
      <td>{names.employer(row.payload.employer_id)}・{names.site(row.payload.establishment_id)}</td>
      <td>{ACTIVITY_LABEL[row.payload.activity] ?? row.payload.activity}</td>
      <td>{periodText(row.payload)}</td>
      <td><StatusPill tone={tone(row.payload.status)}>{STATUS_LABEL[row.payload.status] ?? row.payload.status}</StatusPill></td>
      <td>第{row.revision}版</td>
    </tr>)}</tbody>
  </table></div>;
}

/**
 * Outside work: the declarations as they stand, what can be done next, and the versions
 * the server holds. A form opens only from "next"; every change is confirmed in place.
 * An administrator is given everyone's declarations and the comparison; everyone else
 * their own.
 */
export default function OutsideView({ data, ctx }: { data: DeclarationContext; ctx: RouteContext }) {
  const admin = ctx.role === "ADMIN";
  const names = declarationNames(data, (personId) => nameOf(ctx, personId));
  const current = data.declarations.filter((row) => row.payload.status !== "WITHDRAWN");
  const waiting = current.filter((row) => row.payload.status !== "REVIEWED").length;
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><span className="ideal-eyebrow">兼業・外部勤務</span><h2>申告の状態と次の操作</h2><p>本人の申告と、管理者による他社資料との照合を分けて記録します。</p></div>
      <StatusPill tone={waiting ? "warn" : "good"}>{waiting ? `照合が済んでいない申告 ${waiting}件` : "照合待ちの申告なし"}</StatusPill>
    </section>
    <section className="ideal-panel" aria-labelledby="outside-current-title">
      <h2 id="outside-current-title">現在の状態</h2>
      <p>{admin ? "この部署の全員の申告です。" : "あなたの申告です。"}取り下げた申告は「履歴」にあります。</p>
      {current.length ? <Declarations label="現在の申告" rows={current} names={names} /> : <p className="ideal-note">現在の申告はありません。</p>}
      {current.filter((row) => !row.actions.change.allowed).map((row) => <p className="ideal-note" key={row.entity_id}>{names.employer(row.payload.employer_id)}（{periodText(row.payload)}）：{row.actions.change.refusal}</p>)}
    </section>
    <section className="ideal-panel" aria-labelledby="outside-next-title">
      <h2 id="outside-next-title">次の操作</h2>
      <div className="ideal-stack">
        <TaskDisclosure summary="申告を登録・訂正する"><DeclarationEditor context={data} /></TaskDisclosure>
        <TaskDisclosure summary="申告を取り下げる"><WithdrawDeclaration context={data} /></TaskDisclosure>
        {admin && <TaskDisclosure summary="申告を他社資料と照合する（管理者）"><ReviewDeclaration context={data} /></TaskDisclosure>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="outside-history-title">
      <h2 id="outside-history-title">履歴</h2>
      <p>取り下げた申告を含む、各申告の現在の版です。この画面が受け取るのは現在の版だけで、以前の版の内容は表示できません。保存した時刻・操作した役割・版は監査の履歴に記録されます。
        {admin && <> <WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></>}</p>
      {data.declarations.length ? <Declarations label="申告の履歴（現在の版）" rows={data.declarations} names={names} /> : <p className="ideal-note">申告の記録はありません。</p>}
    </section>
  </div>;
}
