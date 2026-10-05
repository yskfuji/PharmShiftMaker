// A record as the labelled lines a person reads. Each screen says how its record reads
// (`Fact[]`); the comparisons below are the same for every record.
export type Fact = { label: string; text: string };
export type Change = { label: string; before: string; after: string };
export type ThreeWayRow = { label: string; base: string; current: string; proposed: string };

const ABSENT = "（なし）";
const textOf = (facts: Fact[] | null, label: string) => facts?.find((fact) => fact.label === label)?.text ?? ABSENT;

/** The lines that differ between the current version (null: there is none yet) and the edit. */
export const changedFacts = (before: Fact[] | null, after: Fact[]): Change[] =>
  after.map((fact) => ({ label: fact.label, before: textOf(before, fact.label), after: fact.text }))
    .filter((change) => change.before !== change.after);

/** Every line at the start of the edit, on the server now, and as edited. */
export const threeWayRows = (base: Fact[] | null, current: Fact[] | null, proposed: Fact[]): ThreeWayRow[] =>
  proposed.map((fact) => ({ label: fact.label, base: textOf(base, fact.label), current: textOf(current, fact.label), proposed: fact.text }));
