import { PlanningError } from "@/lib/planningTransport";

/** A 404 says there is nothing for this scope or period yet; it is not a failed read. */
export const noneWhenMissing = <T,>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (error instanceof PlanningError && error.status === 404) return null;
    throw error;
  });
