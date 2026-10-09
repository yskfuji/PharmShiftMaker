// What a route's server read hands to an island that goes on reading the same resource by
// itself (after a save, after a conflict, or to try again): the answer, or why it could not
// be read. Plain data, so it crosses from the server to the browser as a prop.
import { problemFrom } from "@/ideal/api/errors";
import type { ProblemModel } from "@/ideal/model";
import { PlanningError } from "@/lib/planningTransport";

export type Seed<T> = { data: T; problem: null } | { data: null; problem: ProblemModel };

/** A refused read becomes the island's own problem, shown where the answer would be, so the
 * rest of the route stays. An expired session is never that: it is the route's problem. */
export async function seedOf<T>(read: Promise<T>): Promise<Seed<T>> {
  try {
    return { data: await read, problem: null };
  } catch (error) {
    if (error instanceof PlanningError && error.status === 401) throw error;
    return { data: null, problem: problemFrom(error, "read") };
  }
}
