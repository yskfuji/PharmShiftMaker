"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import { useMounted } from "./hydration";

/** How a task presents itself among the others: the one the route points at (primary), an
 * ordinary one (routine), one that only shows something (info), one that cannot be undone
 * (danger). Declared where the task is declared, never derived from data. */
export type TaskTone = "primary" | "routine" | "info" | "danger";
/** `id` is for a control that leads to the task; `hint` says in one line what the task
 * does; `tag` is a word shown with it while the task is closed. A danger task always carries
 * its tag, so that its tone is never told by colour alone. */
export type TaskLook = { id?: string; hint?: string } & ({ tone?: "primary" | "routine" | "info"; tag?: string } | { tone: "danger"; tag: string });

/** Said under the summary of an open danger task, after its tag. */
const NO_WAY_BACK = "実行すると元に戻せません。内容を確かめてから進めてください。";

/** The first line of what an open danger task holds: its tag and one fixed sentence. Closed,
 * the tag is beside the summary (TaskFrame); open, that line is not drawn and this one is, so
 * the tag is on screen once, under the summary and never above it. The tag ends its own
 * sentence here: no element of the task but the closed tag has the tag as its whole text. */
function TaskWarning({ tone, tag }: TaskLook) {
  if (tone !== "danger") return null;
  return <p className="ideal-v3-task__warning"><strong>{/[。．.！!]$/.test(tag) ? tag : `${tag}。`}</strong>{NO_WAY_BACK}</p>;
}

/** The frame of a task. The hint and the tag are beside the summary, not in it: the
 * summary's text and name stay what the route's journeys look for, and the summary is
 * described by the hint (tag included) whether the task is open or closed: an open task
 * does not draw the line, and a description is read from a line that is not drawn. */
function TaskFrame({ tone = "routine", hint, tag, children }: TaskLook & { children: (describedBy: string | undefined) => ReactNode }) {
  const hintId = useId();
  const described = Boolean(hint || tag);
  return <div className={`ideal-v3-task ideal-v3-task--${tone}`}>
    {children(described ? hintId : undefined)}
    {described && <p id={hintId} className="ideal-v3-task__hint">{tag && <span className={tone === "danger" ? "ideal-pill ideal-pill--danger" : "ideal-pill"}>{tag}</span>}{hint && <span>{hint}</span>}</p>}
  </div>;
}

/**
 * One task of a route's "next action": closed until it is opened, and without a field
 * until React has attached, so nothing can be typed into a form that cannot answer yet.
 * The summary is in the server HTML; a task opened there stays open. What the task holds
 * is a group named by its summary, so its fields are told apart from another task's.
 */
export default function TaskDisclosure({ summary, children, ref, id, ...look }: { summary: string; children: ReactNode; /** For a control that opens the task from elsewhere on the route. */ ref?: Ref<HTMLDetailsElement> } & TaskLook) {
  const mounted = useMounted();
  // `open` belongs to the viewer: a task opened in the server HTML is left as it is.
  return <TaskFrame {...look}>{(describedBy) => <details ref={ref} id={id} className="ideal-v3-disclosure" suppressHydrationWarning>
    <summary aria-describedby={describedBy}>{summary}</summary>
    <TaskWarning {...look} />
    {mounted ? <div role="group" aria-label={summary}>{children}</div> : <p className="ideal-note">この操作を準備しています。</p>}
  </details>}</TaskFrame>;
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
export function OnDemandTask<T>({ summary, resource, children, id, ...look }: { summary: string; resource: OnDemand<T>; children: (data: T) => ReactNode } & TaskLook) {
  const details = useRef<HTMLDetailsElement>(null);
  const { ensure } = resource;
  // A task opened in the server HTML raised no event here.
  useEffect(() => { if (details.current?.open) ensure(); }, [ensure]);
  return <TaskFrame {...look}>{(describedBy) => <details ref={details} id={id} className="ideal-v3-disclosure" suppressHydrationWarning onToggle={(event) => { if (event.currentTarget.open) ensure(); }}>
    <summary aria-describedby={describedBy}>{summary}</summary>
    <TaskWarning {...look} />
    {resource.problem && <div>
      <InlineProblem problem={resource.problem} />
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={resource.loading} onClick={() => void resource.reload()}>もう一度読み込む</button></div>
    </div>}
    {resource.data !== null ? <div role="group" aria-label={summary}>{children(resource.data)}</div> : !resource.problem && <p className="ideal-note" role="status">{resource.loading ? "この操作に必要な記録を読み込んでいます。" : "開くと、この操作に必要な記録を読み込みます。"}</p>}
  </details>}</TaskFrame>;
}
