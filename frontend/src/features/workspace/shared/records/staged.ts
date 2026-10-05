// The records of one kind as a task lists and chooses them. The workflow context stages
// the saved records over the input version; a saved record carries a revision, a value the
// input alone holds has none yet.
export type StoredRow = { kind: string; entity_id: string; revision: number; payload: Record<string, unknown> };
/** `revision` 0: only the input holds the value; it has not been saved as a record. */
export type Versioned<P> = { key: string; revision: number; payload: P };

/** The staged values of one kind, each with the revision of its saved record (the saved
 * content wins over the staged one), followed by the saved records the input does not stage. */
export function stagedRecords<P>(staged: P[] | undefined, rows: StoredRow[], kind: string, identity: (payload: P) => string): Versioned<P>[] {
  const saved = rows.filter((row) => row.kind === kind);
  const listed = (staged ?? []).map((payload) => {
    const row = saved.find((item) => item.entity_id === identity(payload));
    return { key: identity(payload), revision: row?.revision ?? 0, payload: (row?.payload ?? payload) as P };
  });
  const others = saved.filter((row) => !listed.some((item) => item.key === row.entity_id)).map((row) => ({ key: row.entity_id, revision: row.revision, payload: row.payload as P }));
  return [...listed, ...others];
}
