import type { ReactNode } from "react";

/** One line of identifiers: what it is the identifier of (in words), and the identifier
 * itself, or several of one kind. `note` is what else is said of it, after it (a version). */
export type IdentifierItem = { label: ReactNode; value?: string | null; values?: string[]; note?: ReactNode; /** Said when there is no identifier, in place of 「（なし）」. */ none?: string; key?: string };

/** Said in place of an identifier there is none of. */
const NONE = "（なし）";

/**
 * The identifiers of what a view shows, in the one form the workspace has for them: a list
 * of what each is the identifier of and the identifier as code. An identifier is what the
 * system or an outside system assigned (a record key, a hash, an account): it is never
 * needed to read the view, so it stands inside a reveal (below) and not among the facts.
 * The colon after a label is for a screen reader and for reading the line as text; on
 * screen the two columns say it.
 */
export function IdentifierList({ items, label }: { items: IdentifierItem[]; label?: string }) {
  return <dl className="ideal-definition-list ideal-v3-identifiers" aria-label={label}>{items.map((item, index) => {
    const values = item.values ?? (item.value ? [item.value] : []);
    return <div key={item.key ?? index}>
      <dt>{item.label}<span className="sr-only">：</span></dt>
      <dd>{values.length ? values.map((value, place) => <span key={`${place}:${value}`}>{place > 0 && <span className="sr-only">、</span>}<code>{value}</code></span>) : item.none ?? NONE}{item.note}</dd>
    </div>;
  })}</dl>;
}

/**
 * The reveal that holds a view's identifiers: a line of text that opens (the info reveal of
 * the primitives), named 「識別情報」 unless its owner names it, with the list above.
 * `children` is what else belongs with them (a second list the owner draws). With nothing
 * to list and nothing else, nothing is drawn.
 */
export default function Identifiers({ summary = "識別情報", items, label, children }: { summary?: string; items: IdentifierItem[]; label?: string; children?: ReactNode }) {
  if (!items.length && !children) return null;
  return <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>{summary}</summary>
    {items.length > 0 && <IdentifierList items={items} label={label} />}
    {children}
  </details>;
}
