"use client";

import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { problemFrom } from "../api/errors";
import type { Evidence } from "../api/client";
import type { ProblemModel } from "../model";
import { LoadingState, ProblemState, StatusPill } from "../ui/atoms";

/** The reason and reference every change records (the server requires 3–500 characters). */
export function EvidenceFields({ value, onChange, legend = "根拠" }: { value: Evidence; onChange: Dispatch<SetStateAction<Evidence>>; legend?: string }) {
  const id = useId();
  return (
    <fieldset className="ideal-fieldset">
      <legend>{legend}</legend>
      <label htmlFor={`${id}-reason`}>理由<span>3文字以上</span></label>
      <input id={`${id}-reason`} className="ideal-input" value={value.reason} minLength={3} maxLength={500} required
        onChange={(e) => { const reason = e.target.value; onChange((current) => ({ ...current, reason })); }} />
      <label htmlFor={`${id}-reference`}>参照（記録番号・連絡の記録など）<span>3文字以上</span></label>
      <input id={`${id}-reference`} className="ideal-input" value={value.reference} minLength={3} maxLength={500} required
        onChange={(e) => { const reference = e.target.value; onChange((current) => ({ ...current, reference })); }} />
    </fieldset>
  );
}

export const EMPTY_EVIDENCE: Evidence = { reason: "", reference: "" };
export const evidenceReady = (e: Evidence) => e.reason.trim().length >= 3 && e.reference.trim().length >= 3;

/** A failed change shown where it happened: conflict, permission, validation or unknown outcome. */
export function InlineProblem({ problem }: { problem: ProblemModel }) {
  return (
    <div className="ideal-inline-problem" role="alert">
      <StatusPill tone={problem.kind === "forbidden" ? "neutral" : "warn"}>{problem.code}</StatusPill>
      <div><strong>{problem.title}</strong><p>{problem.body}</p></div>
    </div>
  );
}

/** Runs one change, keeps its error, and reports when it finished. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(action: () => Promise<string | void>) {
    setBusy(true); setProblem(null); setDone(null);
    try {
      const message = await action();
      if (message) setDone(message);
    } catch (error) {
      setProblem(problemFrom(error, "write"));
    } finally {
      setBusy(false);
    }
  }
  function clear() { setProblem(null); setDone(null); }
  return { busy, problem, done, run, clear };
}

/** The live region is always present, so screen readers announce what is put into it. */
export function ActionStatus({ problem, done }: { problem: ProblemModel | null; done: string | null }) {
  return <>{problem && <InlineProblem problem={problem} />}<p className="ideal-done" role="status">{done ?? ""}</p></>;
}

/** A read in progress, a read that failed, or its content. */
export function Loaded<T>({ resource, children }: { resource: { data: T | null; problem: ProblemModel | null; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (resource.problem) return <ProblemState problem={resource.problem} onAction={resource.reload} />;
  if (resource.data === null) return <LoadingState />;
  return <>{children(resource.data)}</>;
}
