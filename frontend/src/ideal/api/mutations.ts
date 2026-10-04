// One idempotency key per intended change. The key is kept while the outcome is unknown
// (no response, 408, 429 or a 5xx: the same set errors.ts shows as "unknown"), so sending
// the same contents again is answered from the server's receipt instead of doing the
// change twice. A definite answer (2xx, or another 4xx) ends the attempt; changed
// contents are a new attempt with a new key.
import { PlanningError } from "@/lib/planningTransport";

/** A 4xx other than a timeout (408) or a rate limit (429) says the change did not happen. */
export const definite = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

export type Mutate = <T>(name: string, contents: unknown, send: (key: string) => Promise<T>) => Promise<T>;

/** `owner`: the signed-in account; its keys are never reused for another account. */
export function createMutator(owner = "", newKey: () => string = () => crypto.randomUUID()): Mutate {
  const keys = new Map<string, string>();
  return async function mutate<T>(name: string, contents: unknown, send: (key: string) => Promise<T>): Promise<T> {
    const fingerprint = JSON.stringify([owner, name, contents]);
    let key = keys.get(fingerprint);
    if (!key) { key = newKey(); keys.set(fingerprint, key); }
    try {
      const result = await send(key);
      keys.delete(fingerprint);
      return result;
    } catch (error) {
      if (error instanceof PlanningError && definite(error.status)) keys.delete(fingerprint);
      throw error;
    }
  };
}
