"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { problemFrom } from "../api/errors";
import type { ProblemModel } from "../model";

/**
 * One read for a screen. `key` names what is read (e.g. the scope and publication); a
 * new key reads again, and a newer read wins over a slower older one.
 */
export function useResource<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; problem: ProblemModel | null; loading: boolean }>({ data: null, problem: null, loading: true });
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
  useEffect(() => { void reload(); }, [reload, key]);
  return { ...state, reload };
}
