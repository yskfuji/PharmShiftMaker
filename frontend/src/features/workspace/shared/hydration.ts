"use client";

import { useEffect, useEffectEvent, useSyncExternalStore, type RefObject } from "react";

const never = () => () => undefined;

/** False in the server HTML and while React attaches to it; true from then on. */
export const useMounted = (): boolean => useSyncExternalStore(never, () => true, () => false);

/**
 * A server-rendered field can be used before React attaches to it. React keeps what the
 * browser holds but hears no event for it, so the island's draft would stay empty and its
 * next render would put the empty draft back. Once, after mounting, `adopt` is given the
 * fields so the draft starts from what was already entered.
 */
export function useEnteredBeforeMount(fields: RefObject<HTMLElement | null>, adopt: (fields: HTMLElement) => void) {
  const adoptOnce = useEffectEvent(() => { if (fields.current) adopt(fields.current); });
  useEffect(() => adoptOnce(), []);
}
