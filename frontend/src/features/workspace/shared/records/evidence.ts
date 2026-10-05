// The evidence a compliance record carries: its source document, whether it was verified
// and by whom, and until when it is valid. (A change's `{reason, reference}` is another
// shape: see EvidenceFields in @/ideal/live/parts.)
import { jstText } from "../jst";
import type { Fact } from "./facts";

export type RecordEvidence = { reference: string; status: "unverified" | "verified" | "rejected"; verified_by: string | null; valid_until: string | null };

export const EMPTY_RECORD_EVIDENCE: RecordEvidence = { reference: "", status: "unverified", verified_by: null, valid_until: null };
export const EVIDENCE_STATUS: Record<RecordEvidence["status"], string> = { unverified: "未確認", verified: "確認済み", rejected: "不採用" };

/** The evidence as the lines a person reads; `name` says which evidence of the record it is. */
export const evidenceFacts = (name: string, evidence: RecordEvidence | null | undefined): Fact[] => [
  { label: `${name}の資料`, text: evidence?.reference || "（なし）" },
  { label: `${name}の状態`, text: evidence ? EVIDENCE_STATUS[evidence.status] ?? evidence.status : "（なし）" },
  { label: `${name}の確認責任者`, text: evidence?.verified_by || "（なし）" },
  { label: `${name}の有効期限`, text: jstText(evidence?.valid_until) || "期限なし" },
];
