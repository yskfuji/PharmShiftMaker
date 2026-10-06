import { useId } from "react";

/** One record the server refuses for a step: how the record is named (`typed` when the name
 * holds words a person entered), and the server's reason. */
export type Refused = { key: string; name: string; typed?: boolean; reason: string | null | undefined };

/** The records the server refuses for a step, each with the server's reason, under the
 * caption that says what the list is. The caption names the list. Each record is a row of
 * its own in a quiet frame (which record, then why), not a bullet of running text; the colon
 * between the two is for a screen reader. */
export default function RefusedList({ label, items }: { label: string; items: Refused[] }) {
  const id = useId();
  return <div className="ideal-v3-flextime-refused">
    <h4 id={id} className="ideal-v3-heading">{label}</h4>
    <ul role="list" className="ideal-note-list" aria-labelledby={id}>{items.map((item) => <li key={item.key}><strong data-verbatim={item.typed ? "" : undefined}>{item.name}</strong><span className="sr-only">：</span><span>{item.reason}</span></li>)}</ul>
  </div>;
}
