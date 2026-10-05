// The required staffing of one input version, as the demand editor shows and edits it.
// Display and entry only: whether the staffing can be met, and whether a record is valid,
// is decided by the server (its issues are passed through as it reports them).
import { jstText } from "../../../shared/jst";
import { EMPTY_RECORD_EVIDENCE, evidenceFacts } from "../../../shared/records/evidence";
import type { Fact } from "../../../shared/records/facts";
import { stagedRecords, type Versioned } from "../../../shared/records/staged";
import type { DemandContext, DemandPayload } from "../../api";

/** `revision` 0: the demand comes from the input version and has not been saved as a record. */
export type DemandRecord = Versioned<DemandPayload>;

export type DemandState = {
  /** The input version the server answered for. */
  inputHash: string;
  /** False when that is not the input on screen: nothing may be saved against it. */
  matchesInput: boolean;
  canEdit: boolean;
  stagingValid: boolean;
  issues: Array<{ location: string; message: string }>;
  records: DemandRecord[];
  dutyOptions: Array<{ task: string; location: string }>;
};

/** The demands staged over the input, each with the revision of its saved record. */
export const demandRecords = (context: DemandContext): DemandRecord[] =>
  stagedRecords(context.demands, context.records, "demand", (demand) => demand.demand_id);

/** Only what the editor needs of the context; `inputHash` is the input on screen. */
export function demandState(context: DemandContext, inputHash: string): DemandState {
  const pairs = new Map((context.duty_options ?? []).map((option) => [`${option.task}\u0000${option.location}`, { task: option.task, location: option.location }]));
  return {
    inputHash: context.input_hash ?? "",
    matchesInput: Boolean(context.input_hash) && context.input_hash === inputHash,
    canEdit: context.role === "ADMIN" || context.role === "LEADER",
    stagingValid: context.staging_valid !== false,
    issues: (context.validation_issues ?? []).map((issue) => ({ location: Array.isArray(issue.location) ? issue.location.join(" / ") : String(issue.location), message: issue.message })),
    records: demandRecords(context),
    dutyOptions: Array.from(pairs.values()),
  };
}

export const newDemand = (demandId: string): DemandPayload =>
  ({ demand_id: demandId, task: "", location: "", minimum: 0, target: 0, start: "", end: "", evidence: { ...EMPTY_RECORD_EVIDENCE } });

/** A demand as the lines a person reads (the confirmation and the three-way review). */
export const demandFacts = (demand: DemandPayload): Fact[] => [
  { label: "業務", text: demand.task || "（なし）" },
  { label: "場所", text: demand.location || "（なし）" },
  { label: "必須の配置人数", text: `${demand.minimum}名` },
  { label: "希望する配置人数", text: `${demand.target}名` },
  { label: "適用開始（日本時間）", text: jstText(demand.start) || "（なし）" },
  { label: "適用終了（日本時間）", text: jstText(demand.end) || "（なし）" },
  ...evidenceFacts("原本確認", demand.evidence),
];

export const demandLabel = (record: DemandRecord): string =>
  `${record.payload.task}・${record.payload.location} ${jstText(record.payload.start)}〜（${record.revision ? `第${record.revision}版` : "未登録"}）`;
