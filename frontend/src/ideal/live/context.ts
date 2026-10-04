// What the API-backed screens receive from the provider: the client, the key-keeping
// mutation runner, and the viewer's scope as the server reported it.
import type { IdealClient } from "../api/client";
import type { PublicationRead } from "../api/contracts";
import type { Mutate } from "../api/mutations";
import type { IdealRole } from "../types";

export interface LiveApi {
  client: IdealClient;
  mutate: Mutate;
  scopeId: string;
  role: IdealRole;
  /** The viewer's own person in this scope. */
  personId: string;
  publication: PublicationRead | null;
  /** Deep-link selections are syntax-checked, then resolved only against server-returned lists. */
  selectedCaseId: string | null;
  selectedPersonId: string | null;
  isSynthetic?: boolean;
  /** A current publication (of any period) by id; undefined once it was replaced. */
  publicationOf: (publicationId: string) => PublicationRead | undefined;
  /** Names of the scope's people (planners); ids otherwise. */
  nameOf: (personId: string) => string;
  /** Exact roster returned for the active scope; never inferred from one publication. */
  people: Array<{ person_id: string; name: string }>;
  /** Read the workspace again (after a change that publishes a new version). */
  refresh: () => Promise<void>;
}
