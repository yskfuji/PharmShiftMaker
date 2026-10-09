// What the directory keeps of the scope's records. The endpoint it reads returns every
// staged record of the scope (employment, contracts, leave, actual work, publications, …);
// the route's server read reduces that to the people and two counts per person, so nothing
// else of it reaches the browser.
import type { DirectoryRecords } from "@/ideal/api/client";

export type DirectoryPerson = { person_id: string; name: string };
export type DirectoryCounts = { contracts: number; capabilities: number };
export type DirectorySummary = {
  people: DirectoryPerson[];
  /**
   * Per person: the contracts and the qualifications on record. A person without an entry
   * has none. A list, never an object keyed by the identifier: an identifier is whatever
   * text the API holds, and may be the name of something every object has (`__proto__`,
   * `constructor`, `toString`). Read it with `recordsOf`.
   */
  counts: Array<DirectoryCounts & { person_id: string }>;
};

export const NO_RECORDS: DirectoryCounts = { contracts: 0, capabilities: 0 };

/** The counts of one person; none when the summary has no entry for exactly that identifier. */
export const recordsOf = (summary: Pick<DirectorySummary, "counts">, personId: string): DirectoryCounts => {
  const entry = summary.counts.find((item) => item.person_id === personId);
  return entry ? { contracts: entry.contracts, capabilities: entry.capabilities } : NO_RECORDS;
};

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The staged values and the saved records are both counted, as the directory always did. */
export function directoryOf(context: DirectoryRecords): DirectorySummary {
  // A Map: this runs in the server process, and an identifier used as the key of a plain
  // object could reach (and change) what every object inherits.
  const counts = new Map<string, DirectoryCounts>();
  const count = (kind: keyof DirectoryCounts, payloads: Array<Record<string, unknown>>) => {
    for (const payload of payloads) {
      if (!text(payload.person_id)) continue;
      const entry = counts.get(payload.person_id) ?? { ...NO_RECORDS };
      entry[kind] += 1;
      counts.set(payload.person_id, entry);
    }
  };
  const saved = (kind: string) => (context.records ?? []).filter((row) => row.kind === kind).map((row) => row.payload);
  count("contracts", [...(context.contracts ?? []), ...saved("contract")]);
  count("capabilities", [...(context.capabilities ?? []), ...saved("capability")]);
  return {
    people: (context.people ?? []).filter((person) => text(person.person_id)).map(({ person_id, name }) => ({ person_id, name })),
    counts: Array.from(counts, ([person_id, entry]) => ({ person_id, ...entry })),
  };
}
