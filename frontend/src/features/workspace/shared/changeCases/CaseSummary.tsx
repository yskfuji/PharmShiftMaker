import type { PublishedDuty } from "@/ideal/api/contracts";
import type { ScheduleChangeCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { dutyWhen, stamp } from "../format";
import { caseStatusLabel } from "../labels";
import { replacements, validationOf } from "./cases";

const tone = (status: string) => status === "READY" ? "good" : ["AWAITING_CONSENT", "AWAITING_INDEPENDENT_APPROVAL"].includes(status) ? "warn" : status === "DRAFT" ? "danger" : "neutral";

/** Who has consented and who has not yet, by name, from the two lists of the case. */
function consentText(required: string[], consented: string[], nameOf: (personId: string) => string): string {
  const given = required.filter((id) => consented.includes(id)).map(nameOf);
  const open = required.filter((id) => !consented.includes(id)).map(nameOf);
  return [given.length ? `同意済み：${given.join("、")}` : "", open.length ? `まだ：${open.join("、")}` : ""].filter(Boolean).join("／");
}

/** A duty's day and its hours. Each is kept on one line, so a line never ends between a date
 * and its weekday; the two may part where there is no room for both. */
function When({ start, end }: { start: string; end: string }) {
  const [day, ...hours] = dutyWhen(start, end).split(" ");
  return <span className="ideal-v3-case-when"><span>{day}</span> <span>{hours.join(" ")}</span></span>;
}

/** One duty of a case: whether it is removed or added, whose it is, and when. */
function Duty({ change, name, duty }: { change: string; name: string; duty: PublishedDuty }) {
  return <li><span>{change}</span><span className="ideal-v3-case-duty"><strong>{name}</strong><span className="sr-only"> · </span><When start={duty.start} end={duty.end} /></span></li>;
}

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
        <StatusPill tone={tone(c.status)}>{caseStatusLabel(c.status)}</StatusPill>
        <small>更新 {stamp(c.updated_at)}</small>
      </div>
      {affected.length + added.length > 0
        ? <ul className="ideal-duty-list">
          {affected.map((d) => <Duty key={`a-${d.duty_id}`} change="外す" name={nameOf(d.person_id)} duty={d} />)}
          {added.map((d) => <Duty key={`r-${d.duty_id}`} change="入る" name={nameOf(d.person_id)} duty={d} />)}
        </ul>
        : <p className="ideal-note">あなたに関係する勤務はこのケースにありません。</p>}
      {(v.required_consent_person_ids?.length ?? 0) > 0 && <p className="ideal-v3-case-consent">
        <strong>同意 {v.consented_person_ids?.length ?? 0} / {v.required_consent_person_ids?.length}</strong>
        {planner && <span>（{consentText(v.required_consent_person_ids ?? [], v.consented_person_ids ?? [], nameOf)}）</span>}
      </p>}
      {planner && c.status === "DRAFT" && <p className="ideal-note">サーバーの検証で指摘が {v.findings?.length ?? 0} 件あります。このままでは公開できません。取り下げて作り直してください。</p>}
      {planner && c.status === "AWAITING_INDEPENDENT_APPROVAL" && <p className="ideal-note">作成者・対象者とは別の責任者による最終承認が必要です。</p>}
    </div>
  );
}
