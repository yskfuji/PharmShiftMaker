"use client";

import type { MembershipRevision } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { useLive } from "../../shell/WorkspaceRuntime";
import { ROLE } from "../labels";
import Deactivate from "./Deactivate";

/** The reasons shown instead of the button repeat what the server refuses; the server
 * still decides. */
export default function MemberTable({ list, selectedPersonId }: { list: MembershipRevision[]; selectedPersonId: string | null }) {
  const live = useLive();
  const visible = selectedPersonId ? list.filter((member) => member.person_id === selectedPersonId) : list;
  if (!visible.length) return <p className="ideal-note">{selectedPersonId ? "選択した職員の紐付けはありません。" : "紐付けはありません。"}</p>;
  const activeAdmins = list.filter((member) => member.active && member.role === "ADMIN").length;
  return <div className="ideal-table-wrap" role="region" aria-label="紐付けの一覧" tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">職員</th><th scope="col">役割</th><th scope="col">アカウント</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead>
    <tbody>{visible.map((m) => <tr key={m.membership_id}>
      <td>{live.nameOf(m.person_id)}</td><td>{ROLE[m.role]}</td><td>{m.subject}</td>
      <td><StatusPill tone={m.active ? "good" : "neutral"}>{m.active ? "有効" : "無効"}</StatusPill> 版{m.revision}</td>
      <td>{m.active && <Deactivate membershipId={m.membership_id} revision={m.revision} blockedReason={
        m.person_id === live.personId ? "自分自身の所属は無効にできません。別の管理者に依頼してください。"
          : m.role === "ADMIN" && activeAdmins === 1 ? "最後の有効な管理者は無効にできません。"
            : null
      } />}</td>
    </tr>)}</tbody>
  </table></div>;
}
