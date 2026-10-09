// A record as the labelled lines a person reads. Each screen says how its record reads
// (`Fact[]`); the comparisons below are the same for every record.
//
// `verbatim`: the line's text is what a person typed (a reason, a reference to a document,
// the name of who verified it) and is shown back as typed. The owner of the record says so
// where it writes the line; the parts that show lines (ConfirmSurface, ThreeWayTable) then
// mark the element with `data-verbatim`, the workspace's mark for text that is not the
// product's wording (tests/visual/lib/structure.ts does not judge its words as machine
// values). A fixed label, a formatted date or a code named by a map is never verbatim.
export type Fact = { label: string; text: string; verbatim?: true };
export type Change = { label: string; before: string; after: string; verbatim?: true };
export type ThreeWayRow = { label: string; base: string; current: string; proposed: string; verbatim?: true };

const ABSENT = "（なし）";
const textOf = (facts: Fact[] | null, label: string) => facts?.find((fact) => fact.label === label)?.text ?? ABSENT;

/** The lines that differ between the current version (null: there is none yet) and the edit. */
export const changedFacts = (before: Fact[] | null, after: Fact[]): Change[] =>
  after.map((fact): Change => ({ label: fact.label, before: textOf(before, fact.label), after: fact.text, ...(fact.verbatim && { verbatim: true }) }))
    .filter((change) => change.before !== change.after);

/** Every line at the start of the edit, on the server now, and as edited. */
export const threeWayRows = (base: Fact[] | null, current: Fact[] | null, proposed: Fact[]): ThreeWayRow[] =>
  proposed.map((fact): ThreeWayRow => ({ label: fact.label, base: textOf(base, fact.label), current: textOf(current, fact.label), proposed: fact.text, ...(fact.verbatim && { verbatim: true }) }));
