import type { PublishedDuty } from "@/ideal/api/contracts";
import { CASE_STATUS, dutyWhen, stamp } from "@/ideal/live/format";
import type { ScheduleChangeCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { replacements, validationOf } from "./cases";

const tone = (status: string) => status === "READY" ? "good" : ["AWAITING_CONSENT", "AWAITING_INDEPENDENT_APPROVAL"].includes(status) ? "warn" : status === "DRAFT" ? "danger" : "neutral";

/** One case in words: its kind and state, the duties it removes and adds, and how far the
 * consents are. `planner` adds what only a planner is told. */
export default function CaseSummary({ c, nameOf, planner }: { c: ScheduleChangeCase; nameOf: (personId: string) => string; planner: boolean }) {
  const v = validationOf(c);
  const affected = c.affected_assignments as unknown as PublishedDuty[];
  const added = replacements(c);
  return (
    <div className="ideal-case-summary">
      <div className="ideal-case-summary__head">
        <StatusPill tone={c.kind === "ABSENCE" ? "danger" : "info"}>{c.kind === "ABSENCE" ? "欠勤" : "交換"}</StatusPill>
        <StatusPill tone={tone(c.status)}>{CASE_STATUS[c.status] ?? c.status}</StatusPill>
        <small>版{c.version} · 更新 {stamp(c.updated_at)}</small>
      </div>
      <ul className="ideal-duty-list">
        {affected.map((d) => <li key={`a-${d.duty_id}`}><span>外す</span>{nameOf(d.person_id)} · {dutyWhen(d.start, d.end)}</li>)}
        {added.map((d) => <li key={`r-${d.duty_id}`}><span>入る</span>{nameOf(d.person_id)} · {dutyWhen(d.start, d.end)}</li>)}
        {!affected.length && !added.length && <li>あなたに関係する勤務はこのケースにありません。</li>}
      </ul>
      {(v.required_consent_person_ids?.length ?? 0) > 0 && <p className="ideal-note">
        同意 {v.consented_person_ids?.length ?? 0} / {v.required_consent_person_ids?.length}
        {planner ? `（${(v.required_consent_person_ids ?? []).map(nameOf).join("、")}）` : ""}
      </p>}
      {planner && c.status === "DRAFT" && <p className="ideal-note">サーバーの検証で指摘が {v.findings?.length ?? 0} 件あります。このままでは公開できません。取り下げて作り直してください。</p>}
      {planner && c.status === "AWAITING_INDEPENDENT_APPROVAL" && <p className="ideal-note">作成者・対象者とは別の責任者による最終承認が必要です。</p>}
    </div>
  );
}
