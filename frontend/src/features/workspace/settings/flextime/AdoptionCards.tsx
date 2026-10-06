import { StatusPill } from "@/ideal/ui/atoms";
import type { AdoptionRow, FlexListing } from "../api";
import { dayOf, flexNames, hm, lastDayOf, RULE_LABEL, STATUS_LABEL } from "./model";
import Identifiers from "../../shared/Identifiers";

const tone = (status: string) => (status === "confirmed" ? "good" : status === "withdrawn" ? "neutral" : "warn");
const checked = (status: string) => (status === "verified" ? "確認済み" : status === "rejected" ? "不採用" : "未確認");
/** The state of a piece of evidence as a pill: a fixed map of the server's value. */
const Checked = ({ status }: { status: string }) => <StatusPill tone={status === "verified" ? "good" : status === "rejected" ? "danger" : "warn"}>{checked(status)}</StatusPill>;
const windows = (items: Array<{ start: string; end: string }> | undefined) => (items?.length ? items.map((item) => `${item.start.slice(0, 5)}〜${item.end.slice(0, 5)}`).join("、") : "定めなし");

/**
 * The adoptions that are registered or in effect, one card each: its state and its period as
 * the title, its terms as pairs of facts in two even columns (the site with its own period
 * is one of them, so the title needs no explanation on screen), the state of each piece of
 * evidence as a pill, who registered and confirmed it, and its participants as rows of a name, the day
 * the participation starts and its state. Accounts have no names here: an account is the
 * viewer or another administrator. For an adoption awaiting confirmation the server's own
 * reason is shown when this viewer may not confirm it. The colons and brackets that make a
 * row read as a sentence are for a screen reader; on screen the columns and the pills say it.
 * The card is a region named by its heading, and a name is heard without the facts below
 * it: so the heading also carries the site, for assistive technology only. Two sites with
 * adoptions of one period and one state would otherwise be two regions of one name.
 */
export default function AdoptionCards({ listing, adoptions }: { listing: FlexListing; adoptions: AdoptionRow[] }) {
  const names = flexNames(listing);
  return <>{adoptions.map((row) => {
    const adoption = row.payload;
    const people = listing.enrollments.filter((item) => item.payload.adoption_id === row.entity_id);
    const title = `flextime-adoption-${row.entity_id}`;
    return <section key={row.entity_id} className="ideal-v3-flextime-adoption" aria-labelledby={title}>
      <h3 id={title} className="ideal-v3-heading"><StatusPill tone={tone(adoption.status)}>{STATUS_LABEL[adoption.status] ?? adoption.status}</StatusPill><span>採用の期間 <time>{dayOf(adoption.start)}</time> 〜 <time>{lastDayOf(adoption.end)}</time></span><span className="sr-only">、{names.site(adoption.establishment_id)}</span></h3>
      {adoption.status === "registered" && !row.actions.confirm.allowed && <p className="ideal-v3-callout">この採用の確認について、サーバーの回答：{row.actions.confirm.refusal}</p>}
      <dl className="ideal-definition-list ideal-v3-flextime-facts">
        <div><dt>事業場</dt><dd>{names.site(adoption.establishment_id)}</dd></div>
        <div><dt>対象労働者の範囲</dt><dd data-verbatim>{adoption.target_scope}</dd></div>
        <div><dt>清算期間</dt><dd>{adoption.settlement_months}か月（起算日 {adoption.settlement_anchor}）</dd></div>
        <div><dt>標準となる1日</dt><dd>{adoption.standard_day_seconds === null ? "（なし）" : hm(adoption.standard_day_seconds)}</dd></div>
        <div><dt>総労働時間の定め方</dt><dd>{RULE_LABEL[adoption.total_hours_rule] ?? adoption.total_hours_rule}</dd></div>
        <div><dt>協定に書いた総労働時間</dt><dd data-verbatim>{adoption.agreed_total_description}</dd></div>
        <div><dt>フレキシブルタイム</dt><dd>{windows(adoption.flexible_time)}</dd></div>
        <div><dt>コアタイム</dt><dd>{windows(adoption.core_time)}</dd></div>
        <div><dt>登録</dt><dd>{names.account(adoption.created_by)}</dd></div>
        <div><dt>確認</dt><dd>{adoption.reviewed_by ? names.account(adoption.reviewed_by) : "まだ確認されていません"}</dd></div>
        <div className="ideal-v3-flextime-facts__wide"><dt>根拠</dt><dd className="ideal-v3-flextime-marks">
          <span>就業規則の規定 <Checked status={adoption.work_rules_evidence.status} /></span><span className="sr-only">・</span>
          <span>労使協定 <Checked status={adoption.agreement_evidence.status} /></span>
          {adoption.filing && <><span className="sr-only">・</span><span>協定届 {adoption.filing.filed_on} <Checked status={adoption.filing.evidence.status} /></span></>}
        </dd></div>
        {adoption.end_reason && <div className="ideal-v3-flextime-facts__wide"><dt>終了</dt><dd>終了：{names.account(adoption.decided_by)}（<span data-verbatim>{adoption.end_reason}</span>）。{dayOf(adoption.end)} から採用しません。</dd></div>}
      </dl>
      <h4 className="ideal-v3-heading">参加者</h4>
      {people.length === 0 ? <p className="ideal-note">参加者はいません。</p> : <ul className="ideal-v3-flextime-people" aria-label="参加者">{people.map((item) => <li key={item.entity_id}>
        <strong>{names.person(item.payload.person_id)}</strong><span className="sr-only">：</span>
        <span>{dayOf(item.payload.start)} から</span>
        <StatusPill tone={tone(item.payload.status)}>{STATUS_LABEL[item.payload.status] ?? item.payload.status}</StatusPill>
        <small>登録 {names.account(item.payload.created_by)}{item.payload.reviewed_by ? `・確認 ${names.account(item.payload.reviewed_by)}` : ""}{item.payload.withdrawal_reason ? <>・取下げの理由 <span data-verbatim>{item.payload.withdrawal_reason}</span></> : ""}</small>
      </li>)}</ul>}
      <Identifiers items={[
        { label: "採用の識別子", value: row.entity_id }, { label: "事業場の識別子", value: adoption.establishment_id }, { label: "雇用主の識別子", value: adoption.employer_id },
        { label: "登録したアカウント", value: adoption.created_by },
        ...(adoption.reviewed_by ? [{ label: "確認したアカウント", value: adoption.reviewed_by }] : []),
        ...(adoption.decided_by ? [{ label: "取下げ・終了を記録したアカウント", value: adoption.decided_by }] : []),
      ]} />
    </section>;
  })}</>;
}
