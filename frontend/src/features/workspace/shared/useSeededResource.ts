"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import type { ProblemModel } from "@/ideal/model";
import type { Seed } from "./seed";

/**
 * A resource the server already read for this route. Nothing is read when the island
 * appears; `reload` reads it again on demand, and a newer read wins over a slower older
 * one. The seed is the starting state only: a later server read of the route does not
 * replace what the island has read or the viewer has edited since. An island that shows
 * another selection is given a new `key` by its view.
 */
export function useSeededResource<T>(seed: Seed<T>, load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; problem: ProblemModel | null; loading: boolean }>({ data: seed.data, problem: seed.problem, loading: false });
  const latest = useRef(load);
  useLayoutEffect(() => { latest.current = load; });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setState((old) => ({ ...old, loading: true, problem: null }));
    try {
      const data = await latest.current();
      if (current === generation.current) setState({ data, problem: null, loading: false });
    } catch (error) {
      if (current === generation.current) setState({ data: null, problem: problemFrom(error, "read"), loading: false });
    }
  }, []);
  return { ...state, reload };
}
