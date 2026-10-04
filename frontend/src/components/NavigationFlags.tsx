"use client";

import { createContext, useContext, type ReactNode } from "react";
import { primaryNavigation, type NavigationItem } from "@/lib/navigation";

// The server reads IDEAL_UI (lib/featureFlags.ts) in the root layout and passes it here, so
// client components list the same destinations. Without a provider the flag is off.
const IdealUiContext = createContext(false);

export function NavigationFlagsProvider({ idealUi, children }: { idealUi: boolean; children: ReactNode }) {
  return <IdealUiContext.Provider value={idealUi}>{children}</IdealUiContext.Provider>;
}

export function usePrimaryNavigation(): readonly NavigationItem[] {
  return primaryNavigation(useContext(IdealUiContext));
}
