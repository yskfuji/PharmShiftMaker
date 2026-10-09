// Going to a place on the same route, for the buttons that lead there (TaskJump, SectionNav).
// The browser only: called from a press, never while rendering.

/**
 * Goes to the element with this `id`: opens every closed `<details>` it is inside, puts the
 * focus on it and brings it into view. A task (a `<details>`, the `id` of a TaskDisclosure)
 * is opened, which raises its `toggle` (a task that reads on demand reads as if it had been
 * opened by hand); the focus goes to its summary and its frame is what comes into view.
 * Anything else (a heading, a section) takes the focus itself: where it could not, it is
 * given `tabindex="-1"` first, so the view need not have declared it. An `id` that is not
 * on the route does nothing.
 */
export function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  for (let above = target.parentElement; above; above = above.parentElement) {
    if (above instanceof HTMLDetailsElement && !above.open) above.open = true;
  }
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
    target.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
    (target.closest(".ideal-v3-task") ?? target).scrollIntoView({ block: "start" });
    return;
  }
  target.focus({ preventScroll: true });
  if (document.activeElement !== target) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  target.scrollIntoView({ block: "start" });
}
