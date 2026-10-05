// A definite refusal as the list a task shows above its fields.
import type { ProblemModel } from "@/ideal/model";
import type { SummaryIssue } from "../ErrorSummary";
import type { FieldIssue } from "./useRecordSave";

/**
 * The server's refusal in its own words. When it names fields (a FastAPI field list),
 * each message goes with its field: `fieldIdOf` gives the id of the control for a field
 * path of the request, or nothing when the task has no control for it. A refusal that
 * names no field is one line, the server's message.
 */
export function refusalIssues(refusal: { problem: ProblemModel; fields: FieldIssue[] }, fieldIdOf: (path: string) => string | undefined = () => undefined): SummaryIssue[] {
  if (!refusal.fields.length) return [{ message: refusal.problem.body }];
  return refusal.fields.map((issue) => ({ message: issue.message, fieldId: issue.field ? fieldIdOf(issue.field) : undefined }));
}
