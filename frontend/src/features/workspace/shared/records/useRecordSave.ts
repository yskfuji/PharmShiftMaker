"use client";

import { useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { definite } from "@/ideal/api/mutations";
import type { ProblemModel } from "@/ideal/model";
import { PlanningError } from "@/lib/planningTransport";
import { useLive } from "../../shell/WorkspaceRuntime";

export type RecordVersion<P> = { revision: number; payload: P };
export type FieldIssue = { field: string; message: string };
/** What is known after the last attempt. `idle`: nothing was sent, or it was saved. */
export type SaveOutcome<P> =
  | { kind: "idle" }
  /** 409. `current` is the version on the server now; null when the record is not there. */
  | { kind: "conflict"; current: RecordVersion<P> | null }
  /** No answer, or a 5xx: the record may or may not have been saved. */
  | { kind: "unknown"; problem: ProblemModel }
  /** A definite refusal (422, 403, …): nothing was saved. */
  | { kind: "refused"; problem: ProblemModel; fields: FieldIssue[] };

/** A FastAPI field list (`detail: [{loc, msg}]`) as fields; a plain message has none. */
export function fieldIssues(error: PlanningError): FieldIssue[] {
  try {
    const detail = (JSON.parse(error.message.replace(/^\d{3}: /, "")) as { detail?: unknown }).detail;
    if (!Array.isArray(detail)) return [];
    return detail.flatMap((issue: { loc?: unknown; msg?: unknown }) => typeof issue?.msg === "string"
      ? [{ field: Array.isArray(issue.loc) ? issue.loc.filter((part) => part !== "body").join(".") : "", message: issue.msg }]
      : []);
  } catch {
    return [];
  }
}

/**
 * Saves one compliance record against the revision the edit started from.
 * - `body` is `{expected_revision, payload, …}` exactly as the endpoint takes it. One
 *   idempotency key is kept per body (`live.mutate`): after an unknown outcome the same
 *   body goes out again with the same key, and the server answers from its receipt.
 * - 409: nothing is rebased. `readCurrent` reads the version on the server now and the
 *   outcome becomes `conflict`, for a three-way review; the route is read again as well.
 * - Any other definite refusal becomes `refused` with the server's own message.
 * - Saved: the route is read again (`live.refresh()`), and `save` resolves to the answer.
 *   Say "saved" from that answer; the refreshed route arrives later.
 */
export function useRecordSave<P, B extends { expected_revision: number; payload: P }, R>({ name, send, readCurrent }: {
  /** Names the change among the viewer's pending ones, e.g. `record:demand:<id>`. */
  name: string;
  send: (body: B & { idempotency_key: string }) => Promise<R>;
  readCurrent: () => Promise<RecordVersion<P> | null>;
}) {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome<P>>({ kind: "idle" });

  async function save(body: B): Promise<{ saved: true; result: R } | { saved: false }> {
    setBusy(true);
    try {
      let result: R;
      try {
        result = await live.mutate(name, body, (key) => send({ ...body, idempotency_key: key }));
      } catch (error) {
        if (error instanceof PlanningError && error.status === 409) {
          try {
            setOutcome({ kind: "conflict", current: await readCurrent() });
            void live.refresh();
          } catch {
            // The current version could not be read: say so as a conflict, and let the same
            // save be tried again (it will conflict again and read again).
            setOutcome({ kind: "refused", problem: problemFrom(error), fields: [] });
          }
        } else if (error instanceof PlanningError && definite(error.status)) {
          setOutcome({ kind: "refused", problem: problemFrom(error), fields: fieldIssues(error) });
        } else {
          setOutcome({ kind: "unknown", problem: problemFrom(error) });
        }
        return { saved: false };
      }
      // Saved. Reading the route again is not part of the save and cannot undo it.
      setOutcome({ kind: "idle" });
      await live.refresh().catch(() => undefined);
      return { saved: true, result };
    } finally {
      setBusy(false);
    }
  }

  return { busy, outcome, save, clear: () => setOutcome({ kind: "idle" }) };
}
