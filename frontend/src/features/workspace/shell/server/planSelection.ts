// The plan and the input version a planning URL names (`?draft=`, repeated on the
// comparison, and `?input=`). Only their syntax is checked here, as for the other
// selections of the URL: whether they belong to the scope and to each other is decided by
// the API when the route reads them.
import { WorkspaceSelectionError } from "@/ideal/api/workspaceSelection";

export type QueryValue = string | string[] | undefined;
export type PlanSelection = { draftIds: string[]; inputHash: string | null };

// The first character is a letter or a digit, so a value is never "." or ".." (nor any
// run of dots): interpolated into a request path, those would name another path.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** The comparison takes at most six plans; further values of the URL are not read. */
export const MAX_COMPARED_DRAFTS = 6;

const values = (value: QueryValue): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((item) => item !== "");

/** An empty value names nothing; a malformed one is refused, never dropped silently. */
export function resolvePlanSelection(draft: QueryValue, input: QueryValue): PlanSelection {
  const drafts = values(draft);
  if (drafts.some((item) => !IDENTIFIER.test(item))) {
    throw new WorkspaceSelectionError(422, "勤務案の識別子が不正です。");
  }
  const inputs = values(input);
  if (inputs.length > 1 || inputs.some((item) => !IDENTIFIER.test(item))) {
    throw new WorkspaceSelectionError(422, "入力版の識別子が不正です。");
  }
  return { draftIds: drafts.slice(0, MAX_COMPARED_DRAFTS), inputHash: inputs[0] ?? null };
}
