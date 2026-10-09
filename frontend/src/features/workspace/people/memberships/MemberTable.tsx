"use client";

import type { MembershipRevision } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { labelOf } from "../../shared/labels";
import { useLive } from "../../shell/WorkspaceRuntime";
import { ROLE } from "../labels";
import Deactivate from "./Deactivate";
import TableScrollCue from "../../shared/TableScrollCue";

/**
 * The links as a table: who, in which role, with which account, in which state, and what
 * can be done. A link that cannot be deactivated here says why with its state; the reasons
 * repeat what the server refuses, and the server still decides. The account is the
 * identifier the sign-in service sends, shown as an identifier. Above the table, as a
 * warning: this screen cannot make a deactivated link active again. (The server can, when
 * the same account is linked again against the link's current version,
 * application/ideal_workflows.py link_membership; this screen's link form always sends
 * version 0 and is refused for an account that already has a link, so the sentence says
 * what this screen can do and claims nothing about the server.)
 */
export default function MemberTable({ list, selectedPersonId }: { list: MembershipRevision[]; selectedPersonId: string | null }) {
  const live = useLive();
  const visible = selectedPersonId ? list.filter((member) => member.person_id === selectedPersonId) : list;
  if (!visible.length) return <p className="ideal-note">{selectedPersonId ? "選択した職員の紐付けはありません。" : "紐付けはありません。"}</p>;
  const activeAdmins = list.filter((member) => member.active && member.role === "ADMIN").length;
  const blocked = (m: MembershipRevision) => !m.active ? null
    : m.person_id === live.personId ? "自分自身の所属は無効にできません。別の管理者に依頼してください。"
      : m.role === "ADMIN" && activeAdmins === 1 ? "最後の有効な管理者は無効にできません。"
        : null;
  return <>
    <p className="ideal-v3-callout ideal-v3-callout--warn"><strong>無効にした紐付けは、この画面では有効に戻せません。</strong>無効にした職員は、そのアカウントでこの施設・部署の画面を開けなくなります。無効にした紐付けは「無効も表示」で確認できます。「無効にする」を押すと根拠の入力欄が開き、押しただけでは無効になりません。</p>
    <TableScrollCue />
    <div className="ideal-table-wrap" role="region" aria-label="紐付けの一覧" tabIndex={0}><table className="ideal-table">
      <thead><tr><th scope="col">職員</th><th scope="col">役割</th><th scope="col">アカウント</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead>
      <tbody>{visible.map((m) => { const reason = blocked(m); const name = live.nameOf(m.person_id); return <tr key={m.membership_id}>
        <th scope="row">{name}</th><td>{labelOf(ROLE, m.role)}</td><td><code className="ideal-v3-people-account" data-verbatim>{m.subject}</code></td>
        <td><StatusPill tone={m.active ? "good" : "neutral"}>{m.active ? "有効" : "無効"}</StatusPill> 第{m.revision}版{reason && <span className="ideal-note ideal-v3-people-reason">{reason}</span>}</td>
        <td>{m.active && !reason ? <Deactivate membershipId={m.membership_id} revision={m.revision} name={name} /> : <span className="ideal-v3-people-none">なし</span>}</td>
      </tr>; })}</tbody>
    </table></div>
  </>;
}
