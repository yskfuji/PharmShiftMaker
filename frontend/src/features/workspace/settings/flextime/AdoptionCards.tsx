import { StatusPill } from "@/ideal/ui/atoms";
import type { AdoptionRow, FlexListing } from "../api";
import { dayOf, flexNames, hm, lastDayOf, RULE_LABEL, STATUS_LABEL } from "./model";

const tone = (status: string) => (status === "confirmed" ? "good" : status === "withdrawn" ? "neutral" : "warn");
const checked = (status: string) => (status === "verified" ? "確認済み" : status === "rejected" ? "不採用" : "未確認");
const windows = (items: Array<{ start: string; end: string }> | undefined) => (items?.length ? items.map((item) => `${item.start.slice(0, 5)}〜${item.end.slice(0, 5)}`).join("、") : "定めなし");

/**
 * The adoptions that are registered or in effect, each with its terms, who registered and
 * confirmed it, and its participants. Accounts have no names here: an account is the
 * viewer or another administrator. For an adoption awaiting confirmation the server's own
 * reason is shown when this viewer may not confirm it.
 */
export default function AdoptionCards({ listing, adoptions }: { listing: FlexListing; adoptions: AdoptionRow[] }) {
  const names = flexNames(listing);
  return <>{adoptions.map((row) => {
    const adoption = row.payload;
    const people = listing.enrollments.filter((item) => item.payload.adoption_id === row.entity_id);
    const title = `flextime-adoption-${row.entity_id}`;
    return <section key={row.entity_id} aria-labelledby={title}>
      <h3 id={title} className="ideal-v3-heading">{names.site(adoption.establishment_id)}：{dayOf(adoption.start)} から {lastDayOf(adoption.end)} まで <StatusPill tone={tone(adoption.status)}>{STATUS_LABEL[adoption.status] ?? adoption.status}</StatusPill></h3>
      <dl className="ideal-definition-list">
        <div><dt>対象労働者の範囲</dt><dd>{adoption.target_scope}</dd></div>
        <div><dt>清算期間</dt><dd>{adoption.settlement_months}か月（起算日 {adoption.settlement_anchor}）</dd></div>
        <div><dt>総労働時間</dt><dd>{RULE_LABEL[adoption.total_hours_rule] ?? adoption.total_hours_rule}：{adoption.agreed_total_description}</dd></div>
        <div><dt>標準となる1日</dt><dd>{adoption.standard_day_seconds === null ? "（なし）" : hm(adoption.standard_day_seconds)}</dd></div>
        <div><dt>フレキシブルタイム／コアタイム</dt><dd>{windows(adoption.flexible_time)}／{windows(adoption.core_time)}</dd></div>
        <div><dt>根拠</dt><dd>就業規則の規定 {checked(adoption.work_rules_evidence.status)}・労使協定 {checked(adoption.agreement_evidence.status)}{adoption.filing ? `・協定届 ${adoption.filing.filed_on}（${checked(adoption.filing.evidence.status)}）` : ""}</dd></div>
        <div><dt>登録・確認</dt><dd>登録：{names.account(adoption.created_by)}／確認：{adoption.reviewed_by ? names.account(adoption.reviewed_by) : "まだ確認されていません"}</dd></div>
        {adoption.end_reason && <div><dt>終了</dt><dd>終了：{names.account(adoption.decided_by)}（{adoption.end_reason}）。{dayOf(adoption.end)} から採用しません。</dd></div>}
        <div><dt>参加者</dt><dd>{people.length === 0 ? "参加者はいません。" : <ul>{people.map((item) => <li key={item.entity_id}>
          {names.person(item.payload.person_id)}：{dayOf(item.payload.start)} から（{STATUS_LABEL[item.payload.status] ?? item.payload.status}・登録 {names.account(item.payload.created_by)}{item.payload.reviewed_by ? `・確認 ${names.account(item.payload.reviewed_by)}` : ""}{item.payload.withdrawal_reason ? `・取下げの理由 ${item.payload.withdrawal_reason}` : ""}）
        </li>)}</ul>}</dd></div>
      </dl>
      {adoption.status === "registered" && !row.actions.confirm.allowed && <p className="ideal-note">この採用の確認について、サーバーの回答：{row.actions.confirm.refusal}</p>}
      <details className="ideal-v3-disclosure"><summary>識別情報</summary>
        <p className="ideal-note">採用の識別子：{row.entity_id}／事業場の識別子：{adoption.establishment_id}／雇用主の識別子：{adoption.employer_id}／登録したアカウント：{adoption.created_by}{adoption.reviewed_by ? `／確認したアカウント：${adoption.reviewed_by}` : ""}{adoption.decided_by ? `／取下げ・終了を記録したアカウント：${adoption.decided_by}` : ""}</p>
      </details>
    </section>;
  })}</>;
}
