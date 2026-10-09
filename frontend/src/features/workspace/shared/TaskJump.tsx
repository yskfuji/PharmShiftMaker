"use client";

import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import { useMounted } from "./hydration";
import { jumpTo } from "./jump";

/**
 * From a count or a statement in a route's header to what answers it on the same route:
 * the task named by `target` (the `id` of a TaskDisclosure), which is opened with the focus
 * on its summary, or a heading or section with that `id`, which takes the focus (shared/jump.ts).
 * A button, not an anchor: a hash entry in the history would carry no guard stamp for
 * unsaved work. It is rendered once React has attached, because before that it could do
 * nothing.
 */
export default function TaskJump({ target, children }: { target: string; children: ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return <button type="button" className="ideal-link ideal-link--target" onClick={() => jumpTo(target)}>{children}<ArrowDown aria-hidden="true" /></button>;
}
