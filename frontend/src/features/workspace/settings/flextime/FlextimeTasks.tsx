"use client";

import TaskDisclosure from "../../shared/TaskDisclosure";
import type { FlexListing } from "../api";
import AddParticipant from "./AddParticipant";
import ConfirmAdoption from "./ConfirmAdoption";
import ConfirmParticipant from "./ConfirmParticipant";
import EndAdoption from "./EndAdoption";
import RegisterAdoption from "./RegisterAdoption";
import WithdrawAdoption from "./WithdrawAdoption";
import WithdrawParticipant from "./WithdrawParticipant";

/**
 * What can be done next with the facility's flextime. Whether the viewer may manage it at
 * all is the server's answer (`can_manage`, with its reason when not); within each task,
 * what can be done with each record is the server's answer on that record.
 */
export default function FlextimeTasks({ listing }: { listing: FlexListing }) {
  if (!listing.can_manage) return <p className="ideal-note">{listing.manage_refusal ?? "採用の登録と確認はできません。"}（閲覧のみ）</p>;
  return <div className="ideal-stack">
    <TaskDisclosure summary="フレックスタイム制の採用を登録する"><RegisterAdoption listing={listing} /></TaskDisclosure>
    <TaskDisclosure summary="採用を確認する（影響の確認）"><ConfirmAdoption listing={listing} /></TaskDisclosure>
    <TaskDisclosure summary="参加者を追加する"><AddParticipant listing={listing} /></TaskDisclosure>
    <TaskDisclosure summary="参加を確認する"><ConfirmParticipant listing={listing} /></TaskDisclosure>
    <TaskDisclosure summary="参加を取り下げる"><WithdrawParticipant listing={listing} /></TaskDisclosure>
    <TaskDisclosure summary="採用を終了する"><EndAdoption listing={listing} /></TaskDisclosure>
    <TaskDisclosure summary="採用を取り下げる"><WithdrawAdoption listing={listing} /></TaskDisclosure>
  </div>;
}
