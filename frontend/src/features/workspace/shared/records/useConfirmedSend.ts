"use client";

import { useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { definite } from "@/ideal/api/mutations";
import type { ProblemModel } from "@/ideal/model";
import { PlanningError } from "@/lib/planningTransport";
import { useLive } from "../../shell/WorkspaceRuntime";
import type { ConfirmOutcome } from "../ConfirmSurface";
import type { ThreeWayRow } from "./facts";
import { fieldIssues, type FieldIssue } from "./useRecordSave";

/** What is known after the last attempt. `idle`: nothing was sent, or it was done. */
export type SendOutcome<C> =
  | { kind: "idle" }
  /** 409. `current` is what the server holds now; null when it is not there. */
  | { kind: "conflict"; current: C | null }
  | { kind: "unknown"; problem: ProblemModel }
  | { kind: "refused"; problem: ProblemModel; fields: FieldIssue[] };

/**
 * Sends one confirmed change that is not the save of one record's content (a decision on
 * a request, a withdrawal, an entry appended to a shared balance, an assessment). The
 * rules are those of useRecordSave:
 * - one idempotency key per body: after an unknown outcome the same body goes out again
 *   with the same key;
 * - 409: nothing is rebased. `readCurrent` reads what the server holds now and the outcome
 *   becomes `conflict`, for a three-way review; the route is read again as well;
 * - any other definite refusal becomes `refused` with the server's own message;
 * - done: the route is read again, and `run` resolves to the answer.
 */
export function useConfirmedSend<B, R, C>({ name, send, readCurrent }: {
  /** Names the change among the viewer's pending ones. */
  name: string;
  send: (body: B, idempotencyKey: string) => Promise<R>;
  readCurrent: () => Promise<C | null>;
}) {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome<C>>({ kind: "idle" });

  async function run(body: B): Promise<{ done: true; result: R } | { done: false }> {
    setBusy(true);
    try {
      let result: R;
      try {
        result = await live.mutate(name, body, (key) => send(body, key));
      } catch (error) {
        if (error instanceof PlanningError && error.status === 409) {
          try {
            setOutcome({ kind: "conflict", current: await readCurrent() });
            void live.refresh();
          } catch {
            setOutcome({ kind: "refused", problem: problemFrom(error), fields: [] });
          }
        } else if (error instanceof PlanningError && definite(error.status)) {
          setOutcome({ kind: "refused", problem: problemFrom(error), fields: fieldIssues(error) });
        } else {
          setOutcome({ kind: "unknown", problem: problemFrom(error) });
        }
        return { done: false };
      }
      setOutcome({ kind: "idle" });
      await live.refresh().catch(() => undefined);
      return { done: true, result };
    } finally {
      setBusy(false);
    }
  }

  return { busy, outcome, run, clear: () => setOutcome({ kind: "idle" }) };
}

/** The outcome as the confirmation shows it: a conflict is described by its owner (the
 * version on the server now and the three contents, line by line). */
export function conflictOutcome<C>(outcome: SendOutcome<C>, describe: (current: C | null) => { currentRevision: number | null; rows: ThreeWayRow[]; currentText?: string }): ConfirmOutcome {
  return outcome.kind === "conflict" ? { kind: "conflict", ...describe(outcome.current) } : outcome;
}
