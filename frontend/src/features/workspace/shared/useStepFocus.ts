"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A task that continues in another step moves focus to that step's heading, so the next
 * thing read is where the task goes on. Spread `heading(step)` on each step's heading and
 * call `moveTo(step)` together with the change that shows it.
 */
export function useStepFocus<S extends string>() {
  const headings = useRef(new Map<S, HTMLElement>());
  const [target, setTarget] = useState<{ step: S } | null>(null);
  useEffect(() => { if (target) headings.current.get(target.step)?.focus(); }, [target]);
  return {
    heading: (step: S) => ({
      tabIndex: -1,
      ref: (element: HTMLElement | null) => { if (element) headings.current.set(step, element); else headings.current.delete(step); },
    }),
    moveTo: (step: S) => setTarget({ step }),
  };
}
