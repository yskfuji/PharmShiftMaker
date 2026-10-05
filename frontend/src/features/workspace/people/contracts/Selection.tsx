"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Selection = { personId: string; choose: (personId: string) => void };
const SelectionContext = createContext<Selection | null>(null);

/** The person the route is looking at ("" when none): the one the URL names at first, then
 * the one chosen in the list. The current state, the steps and the tasks share it. */
export function PersonSelection({ initial, children }: { initial: string | null; children: ReactNode }) {
  const [personId, choose] = useState(initial ?? "");
  const value = useMemo(() => ({ personId, choose }), [personId]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelectedPerson(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("useSelectedPerson must be used inside PersonSelection");
  return selection;
}
