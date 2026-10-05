"use client";

import { threeWayRows, type Fact } from "../../shared/records/facts";
import type { ConfirmOutcome } from "../../shared/ConfirmSurface";
import { conflictOutcome, type SendOutcome } from "../../shared/records/useConfirmedSend";
import type { LeaveRequestRow } from "../api";

/** A change of one request (a decision or a withdrawal) after a 409: the request at the
 * start, on the server now, and as the change would leave it. */
export function requestOutcome(outcome: SendOutcome<LeaveRequestRow>, facts: (row: LeaveRequestRow) => Fact[], base: LeaveRequestRow, proposed: Fact[]): ConfirmOutcome {
  return conflictOutcome(outcome, (current) => ({ currentRevision: current?.version ?? null, rows: threeWayRows(facts(base), current ? facts(current) : null, proposed) }));
}

export const requestRisk = (version: number) =>
  `保存前の時点では検出されていません。保存時にサーバーが、この申請が第${version}版のままであることを照合します。違っていれば保存せず、競合として知らせます。1件の申請だけを変更するため、一部だけが保存されることはありません。`;
