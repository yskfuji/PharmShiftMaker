import type { ConfirmOutcome } from "../ConfirmSurface";
import { threeWayRows, type Fact } from "./facts";
import type { RecordVersion, SaveOutcome } from "./useRecordSave";

/** What the confirmation shows of the last attempt: a conflict becomes the three contents
 * (at the start of the edit, on the server now, as edited), line by line. */
export function confirmOutcome<P>(outcome: SaveOutcome<P>, facts: (payload: P) => Fact[], base: Fact[] | null, proposed: Fact[]): ConfirmOutcome {
  if (outcome.kind !== "conflict") return outcome;
  const current: RecordVersion<P> | null = outcome.current;
  return { kind: "conflict", currentRevision: current?.revision ?? null, rows: threeWayRows(base, current ? facts(current.payload) : null, proposed) };
}
