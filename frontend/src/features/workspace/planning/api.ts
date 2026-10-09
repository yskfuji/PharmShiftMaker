// The planning purpose's own calls to the records it edits, on the transport of the typed
// client (credentials, 401 handling, error bodies; the server and the showcase pass their
// own). Literal paths, so devtools/er/ia_map.py can map them to their handlers.
import type { IdealClient, Keyed } from "@/ideal/api/client";
import type { RecordEvidence } from "../shared/records/evidence";

/** One required staffing of a time span. Fields this purpose does not edit are sent back as read. */
export type DemandPayload = { demand_id: string; task: string; location: string; minimum: number; target: number; start: string; end: string; evidence: RecordEvidence } & Record<string, unknown>;

/** What the demand editor reads of the workflow context. The endpoint returns more (the
 * roster, contracts, publications, …); nothing else of it is used or kept. */
export type DemandContext = {
  role: string;
  input_hash?: string;
  staging_valid?: boolean;
  validation_issues?: Array<{ location: string | unknown[]; message: string }>;
  demands?: DemandPayload[];
  duty_options?: Array<{ kind: string; task: string; location: string }>;
  records: Array<{ kind: string; entity_id: string; revision: number; payload: Record<string, unknown> }>;
};

export type DemandSaveBody = { expected_revision: number; payload: DemandPayload; input_hash: string };
export type RecordSaved = { key: string; revision: number; kind: string };

export function planningApi(client: Pick<IdealClient, "request">) {
  const request = client.request;
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  return {
    /** The records staged over one input version (planners only: the server requires planning permission). */
    demandContext: (scopeId: string, inputHash: string) =>
      request<DemandContext>(`/compliance/workflow-context?scope_id=${scope(scopeId)}&input_hash=${encodeURIComponent(inputHash)}`),
    /** Saves one demand of the input version named by `input_hash`, against the revision the edit started from. */
    saveDemand: (scopeId: string, body: DemandSaveBody & Keyed) =>
      request<RecordSaved>(`/compliance/records/demand?scope_id=${scope(scopeId)}`, "POST", body),
  };
}
