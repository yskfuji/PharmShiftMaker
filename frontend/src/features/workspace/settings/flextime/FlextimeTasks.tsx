"use client";

import { useId } from "react";
import TaskDisclosure from "../../shared/TaskDisclosure";
import type { FlexListing } from "../api";
import AddParticipant from "./AddParticipant";
import ConfirmAdoption from "./ConfirmAdoption";
import ConfirmParticipant from "./ConfirmParticipant";
import EndAdoption from "./EndAdoption";
import { CONFIRM_TASK } from "./model";
import RegisterAdoption from "./RegisterAdoption";
import WithdrawAdoption from "./WithdrawAdoption";
import WithdrawParticipant from "./WithdrawParticipant";

/**
 * What can be done next with the facility's flextime, in three groups: registering and
 * confirming an adoption, its participants, and bringing an adoption to an end. Whether the
 * viewer may manage it at all is the server's answer (`can_manage`, with its reason when
 * not); within each task, what can be done with each record is the server's answer on that
 * record. The order, the tone and the one-line description of each task are fixed here and
 * never derived from the data. An end date and a withdrawal cannot be undone: the server
 * has no step that takes either back (the adoption or the participation is then registered
 * anew and confirmed by another administrator), so the three tasks that record one have
 * the danger tone and say so in a tag, and each confirms with the destructive button.
 */
export default function FlextimeTasks({ listing }: { listing: FlexListing }) {
  const id = useId();
  if (!listing.can_manage) return <p className="ideal-note">{listing.manage_refusal ?? "採用の登録と確認はできません。"}（閲覧のみ）</p>;
  return <div className="ideal-v3-record">
    <section aria-labelledby={`${id}-adopt`}>
      <h3 id={`${id}-adopt`} className="ideal-v3-heading">採用を登録・確認する</h3>
      <div className="ideal-v3-task-list">
        <TaskDisclosure summary="フレックスタイム制の採用を登録する" hint="就業規則と労使協定の内容を入力し、確認待ちとして登録します。"><RegisterAdoption listing={listing} /></TaskDisclosure>
        <TaskDisclosure id={CONFIRM_TASK} tone="primary" summary="採用を確認する（影響の確認）" hint="別の管理者が登録した採用の影響を確かめ、有効にします。"><ConfirmAdoption listing={listing} /></TaskDisclosure>
      </div>
    </section>
    <section aria-labelledby={`${id}-people`}>
      <h3 id={`${id}-people`} className="ideal-v3-heading">参加者</h3>
      <div className="ideal-v3-task-list ideal-v3-flextime-trio">
        <TaskDisclosure summary="参加者を追加する" hint="参加する職員と参加の開始日を、確認待ちとして登録します。"><AddParticipant listing={listing} /></TaskDisclosure>
        <TaskDisclosure summary="参加を確認する" hint="別の管理者が登録した参加を確かめ、有効にします。"><ConfirmParticipant listing={listing} /></TaskDisclosure>
        <TaskDisclosure tone="danger" tag="取り消せません" summary="参加を取り下げる" hint="確認待ちか開始前の参加を取り下げます。取下げは取り消せません。同じ職員の参加を登録し直せるのは、採用期間内でこれから始まる清算期間の初日からで、その職員のほかの参加と期間が重ならないときです（別の管理者の確認が要ります）。"><WithdrawParticipant listing={listing} /></TaskDisclosure>
      </div>
    </section>
    <section aria-labelledby={`${id}-end`}>
      <h3 id={`${id}-end`} className="ideal-v3-heading">採用を終える</h3>
      <div className="ideal-v3-task-list">
        <TaskDisclosure tone="danger" tag="取り消せません" summary="採用を終了する" hint="開始した採用を、将来の清算期間の初日で終えます。終了日は取り消せません。終了日より後については、開始日を将来の日にした新しい採用を登録できます。始まっている清算期間は、そのまま残ります。"><EndAdoption listing={listing} /></TaskDisclosure>
        <TaskDisclosure tone="danger" tag="取り消せません" summary="採用を取り下げる" hint="確認待ちか開始前の採用を取り下げます。取下げは取り消せません。登録し直すには、開始日を将来の日にした新しい採用として登録します（開始日が過ぎた採用を、同じ開始日で登録し直すことはできません）。"><WithdrawAdoption listing={listing} /></TaskDisclosure>
      </div>
    </section>
  </div>;
}
