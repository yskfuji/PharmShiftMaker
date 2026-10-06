"use client";

import { ArrowDown } from "lucide-react";
import { useId } from "react";
import { useMounted } from "./hydration";
import { jumpTo } from "./jump";

/** One section of a route: the `id` of its heading, what the button says and, beside it,
 * what the section holds (a count the view was given, for example). */
export type SectionItem = { target: string; label: string; meta?: string };

/**
 * The sections of a long route, as buttons under its header: each opens every closed
 * `<details>` its heading is inside, puts the focus on the heading and brings it into view
 * (shared/jump.ts). The view gives the heading the class `ideal-v3-section-nav__target`, so
 * that it does not stop under the top edge. One such step beside a header's badge is a
 * `TaskJump`. Buttons, not anchors: a hash entry in the history would carry no guard stamp
 * for unsaved work. They are in the server HTML, so the row does not appear late, and are
 * disabled until React has attached, because before that they could do nothing. A label
 * must differ from the text of every task summary on the route, which the route's journeys
 * find by exact text.
 */
export default function SectionNav({ label = "この画面の内容", items }: { label?: string; items: SectionItem[] }) {
  const mounted = useMounted();
  const labelId = useId();
  return <nav className="ideal-v3-section-nav" aria-labelledby={labelId}>
    <span id={labelId} className="ideal-v3-section-nav__label">{label}</span>
    {items.map((item) => <button key={item.target} type="button" disabled={!mounted} onClick={() => jumpTo(item.target)}>
      <span>{item.label}{item.meta && <>{" "}<small>{item.meta}</small></>}</span>
      <ArrowDown aria-hidden="true" />
    </button>)}
  </nav>;
}
