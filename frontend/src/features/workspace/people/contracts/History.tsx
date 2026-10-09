import type { ReactNode } from "react";
import DateText from "../../shared/DateText";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf } from "../../shell/routeTypes";
import { agreementLabel, calendarLabel, capabilityLabel, contractLabel, employerName, employmentLabel, periodText, personName, reviewLabel, siteLabel, versionText, type Roster } from "./model";
import RecordTable from "./RecordTable";

/**
 * The versions of the records. Only each record's current version is read here: the earlier
 * versions are kept on the server and are not shown on this route, and that is said first.
 * When and by which role a version was saved is in the audit history, which the button opens.
 */
export default function History({ roster }: { roster: Roster }) {
  const rows: Array<{ kind: string; key: string; label: ReactNode; revision: number }> = [
    ...roster.people.map((item) => ({ kind: "職員", key: item.key, label: item.payload.name || "氏名未登録の職員", revision: item.revision })),
    ...roster.employments.map((item) => ({ kind: "雇用関係・兼業制度", key: item.key, label: employmentLabel(roster, item.payload), revision: item.revision })),
    ...roster.contracts.map((item) => ({ kind: "契約", key: item.key, label: contractLabel(roster, item.payload), revision: item.revision })),
    ...roster.capabilities.map((item) => ({ kind: "資格・監督条件", key: item.key, label: capabilityLabel(roster, item.payload), revision: item.revision })),
    ...roster.capabilityAmendments.map((item) => ({ kind: "資格の取消・失効", key: item.key, label: <>{personName(roster, item.payload.person_id)} <span data-verbatim>{item.payload.reason}</span></>, revision: item.revision })),
    ...roster.employers.map((item) => ({ kind: "雇用主", key: item.key, label: item.payload.name || "名称未登録の雇用主", revision: item.revision })),
    ...roster.establishments.map((item) => ({ kind: "事業場", key: item.key, label: siteLabel(roster, item.payload), revision: item.revision })),
    ...roster.managementModels.map((item) => ({ kind: "兼業の管理モデル", key: item.key, label: `${personName(roster, item.payload.person_id)} ${periodText(item.payload.start, item.payload.end)}`, revision: item.revision })),
    ...roster.agreements.map((item) => ({ kind: "36協定", key: item.key, label: agreementLabel(roster, item.payload), revision: item.revision })),
    ...roster.ruleReviews.map((item) => ({ kind: "規則の適用確認", key: item.key, label: reviewLabel(item.payload), revision: item.revision })),
    ...roster.ruleDecisions.map((item) => ({ kind: "改定規則の公開判断", key: item.key, label: <><code>{item.payload.rule_id}</code> 判断日 <time>{item.payload.decided_on}</time></>, revision: item.revision })),
    ...roster.accountingTransitions.map((item) => ({ kind: "制度切替の集計条件", key: item.key, label: (() => { const before = roster.employments.find((entry) => entry.key === item.payload.before_revision_id)?.payload; return before ? employmentLabel(roster, before) : "切替前の雇用条件が未登録"; })(), revision: item.revision })),
    ...roster.siteDecisions.map((item) => ({ kind: "事業場間の時間外の帰属の判断", key: item.key, label: `${employerName(roster, item.payload.employer_id)} ${periodText(item.payload.start, item.payload.end)}`, revision: item.revision })),
    ...roster.annualCalendars.map((item) => ({ kind: "1年単位の変形労働時間制のカレンダー", key: item.key, label: calendarLabel(roster, item.payload), revision: item.revision })),
  ];
  const latest = Math.max(0, ...rows.map((row) => row.revision));
  return <>
    <p>この画面に表示しているのは、各記録の現在の版です。いつ・どの役割が記録を変更したかは、この画面には表示されません。監査の履歴で確認できます。</p>
    <dl className="ideal-definition-list">
      <div><dt>登録されている記録</dt><dd>{rows.length}件{latest > 0 ? `（最も新しい版は第${latest}版）` : ""}</dd></div>
      <div><dt>以前の版</dt><dd>保存のたびに記録の版が1つ進み、以前の版は上書きされずにサーバーに残ります。以前の版の内容は、この画面には表示されません。</dd></div>
      <div><dt>操作の記録</dt><dd>保存した時刻・操作した役割・版は、監査の履歴に記録されます。</dd></div>
    </dl>
    <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></div>
    <details className="ideal-v3-disclosure ideal-v3-disclosure--info">
      <summary>すべての記録の現在の版を一覧する（{rows.length}件）</summary>
      <RecordTable label="すべての記録の現在の版" empty="登録されている記録はありません。" columns={["記録", "種類", "現在の版"]}
        rows={rows.map((row) => ({ key: `${row.kind}:${row.key}`, cells: [typeof row.label === "string" ? <DateText key="label">{row.label}</DateText> : row.label, row.kind, versionText(row.revision)] }))} />
    </details>
  </>;
}
