"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import { useMounted } from "./hydration";

/**
 * One task of a route's "next action": closed until it is opened, and without a field
 * until React has attached, so nothing can be typed into a form that cannot answer yet.
 * The summary is in the server HTML; a task opened there stays open. What the task holds
 * is a group named by its summary, so its fields are told apart from another task's.
 */
export default function TaskDisclosure({ summary, children, ref }: { summary: string; children: ReactNode; /** For a control that opens the task from elsewhere on the route. */ ref?: Ref<HTMLDetailsElement> }) {
  const mounted = useMounted();
  // `open` belongs to the viewer: a task opened in the server HTML is left as it is.
  return <details ref={ref} className="ideal-v3-disclosure" suppressHydrationWarning>
    <summary>{summary}</summary>
    {mounted ? <div role="group" aria-label={summary}>{children}</div> : <p className="ideal-note">この操作を準備しています。</p>}
  </details>;
}

export type OnDemand<T> = { data: T | null; problem: ProblemModel | null; loading: boolean; ensure: () => void; reload: () => Promise<T | null> };

/**
 * What only a task needs, read when the task is first opened and not when the route is
 * shown. `ensure` reads once; `reload` reads again (after a save or a conflict) and a newer
 * read wins over a slower older one. A failed read is the task's own problem.
 */
export function useOnDemand<T>(load: () => Promise<T>): OnDemand<T> {
  const [state, setState] = useState<{ data: T | null; problem: ProblemModel | null; loading: boolean }>({ data: null, problem: null, loading: false });
  const latest = useRef(load);
  useLayoutEffect(() => { latest.current = load; });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setState((old) => ({ ...old, loading: true, problem: null }));
    try {
      const data = await latest.current();
      if (current === generation.current) setState({ data, problem: null, loading: false });
      return data;
    } catch (error) {
      if (current === generation.current) setState((old) => ({ data: old.data, problem: problemFrom(error, "read"), loading: false }));
      return null;
    }
  }, []);
  const ensure = useCallback(() => { if (generation.current === 0) void reload(); }, [reload]);
  return { ...state, ensure, reload };
}

/** A task whose form needs `resource`: opening it reads the resource (several tasks may
 * share one). The task is shown from the answer; until then it says that it is reading,
 * or why it could not. */
export function OnDemandTask<T>({ summary, resource, children }: { summary: string; resource: OnDemand<T>; children: (data: T) => ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const { ensure } = resource;
  // A task opened in the server HTML raised no event here.
  useEffect(() => { if (details.current?.open) ensure(); }, [ensure]);
  return <details ref={details} className="ideal-v3-disclosure" suppressHydrationWarning onToggle={(event) => { if (event.currentTarget.open) ensure(); }}>
    <summary>{summary}</summary>
    {resource.problem && <div>
      <InlineProblem problem={resource.problem} />
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={resource.loading} onClick={() => void resource.reload()}>もう一度読み込む</button></div>
    </div>}
    {resource.data !== null ? <div role="group" aria-label={summary}>{children(resource.data)}</div> : !resource.problem && <p className="ideal-note" role="status">{resource.loading ? "この操作に必要な記録を読み込んでいます。" : "開くと、この操作に必要な記録を読み込みます。"}</p>}
  </details>;
}
