import type { ReactNode } from "react";

/**
 * Short fields side by side: a date, a time, a number or a choice does not need the width
 * of a form, and a form of nothing but such fields in one column runs long. A row holds two
 * or three fields (`Field`: a label and its control, in the order they have in the form);
 * where the form is narrow (below 900px) the row is the single column it would have been,
 * so labels, their order and their controls are the same at every width. Layout only:
 * nothing here knows what a field is for.
 */
export default function FieldRow({ children }: { children: ReactNode }) {
  return <div className="ideal-v3-field-row">{children}</div>;
}

/** One field of a row: its label, then its control (two siblings, as in a form's own grid). */
export function Field({ children }: { children: ReactNode }) {
  return <div className="ideal-v3-field">{children}</div>;
}
