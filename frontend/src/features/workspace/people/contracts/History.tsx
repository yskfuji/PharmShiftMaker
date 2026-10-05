import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf } from "../../shell/routeTypes";
import { agreementLabel, calendarLabel, capabilityLabel, contractLabel, employerName, employmentLabel, periodText, personName, reviewLabel, siteLabel, versionText, type Roster } from "./model";
import RecordTable from "./RecordTable";

/**
 * The versions of the records. The API returns each record's current version only: the
 * earlier versions are kept on the server but cannot be read here, and that is said. When
 * and by which role a version was saved is in the audit history.
 */
export default function History({ roster }: { roster: Roster }) {
  const rows = [
    ...roster.people.map((item) => ({ kind: "職員", key: item.key, label: item.payload.name || "氏名未登録の職員", revision: item.revision })),
    ...roster.employments.map((item) => ({ kind: "雇用関係・兼業制度", key: item.key, label: employmentLabel(roster, item.payload), revision: item.revision })),
    ...roster.contracts.map((item) => ({ kind: "契約", key: item.key, label: contractLabel(roster, item.payload), revision: item.revision })),
    ...roster.capabilities.map((item) => ({ kind: "資格・監督条件", key: item.key, label: capabilityLabel(roster, item.payload), revision: item.revision })),
    ...roster.capabilityAmendments.map((item) => ({ kind: "資格の取消・失効", key: item.key, label: `${personName(roster, item.payload.person_id)} ${item.payload.reason}`, revision: item.revision })),
    ...roster.employers.map((item) => ({ kind: "雇用主", key: item.key, label: item.payload.name || "名称未登録の雇用主", revision: item.revision })),
    ...roster.establishments.map((item) => ({ kind: "事業場", key: item.key, label: siteLabel(roster, item.payload), revision: item.revision })),
    ...roster.managementModels.map((item) => ({ kind: "兼業の管理モデル", key: item.key, label: `${personName(roster, item.payload.person_id)} ${periodText(item.payload.start, item.payload.end)}`, revision: item.revision })),
    ...roster.agreements.map((item) => ({ kind: "36協定", key: item.key, label: agreementLabel(roster, item.payload), revision: item.revision })),
    ...roster.ruleReviews.map((item) => ({ kind: "規則の適用確認", key: item.key, label: reviewLabel(item.payload), revision: item.revision })),
    ...roster.ruleDecisions.map((item) => ({ kind: "改定規則の公開判断", key: item.key, label: `${item.payload.rule_id} 判断日 ${item.payload.decided_on}`, revision: item.revision })),
    ...roster.accountingTransitions.map((item) => ({ kind: "制度切替の集計条件", key: item.key, label: (() => { const before = roster.employments.find((entry) => entry.key === item.payload.before_revision_id)?.payload; return before ? employmentLabel(roster, before) : "切替前の雇用条件が未登録"; })(), revision: item.revision })),
    ...roster.siteDecisions.map((item) => ({ kind: "事業場間の時間外の帰属の判断", key: item.key, label: `${employerName(roster, item.payload.employer_id)} ${periodText(item.payload.start, item.payload.end)}`, revision: item.revision })),
    ...roster.annualCalendars.map((item) => ({ kind: "1年単位の変形労働時間制のカレンダー", key: item.key, label: calendarLabel(roster, item.payload), revision: item.revision })),
  ];
  const latest = Math.max(0, ...rows.map((row) => row.revision));
  return <div className="ideal-v3-record">
    <section aria-labelledby="contracts-history-versions-title">
      <h3 id="contracts-history-versions-title" className="ideal-v3-heading">版と変更の記録</h3>
      <dl className="ideal-definition-list">
        <div><dt>表示している版</dt><dd>各記録の現在の版です。以前の版の内容は、APIが返さないため、この画面では表示できません。</dd></div>
        <div><dt>登録されている記録</dt><dd>{rows.length}件{latest > 0 ? `（最も新しい版は第${latest}版）` : ""}</dd></div>
        <div><dt>変更の履歴</dt><dd>保存のたびに記録の版が1つ進み、以前の版は上書きされずにサーバーに残ります。保存した時刻・操作した役割・版は監査の履歴に記録されます。 <WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></dd></div>
      </dl>
      <details className="ideal-v3-disclosure">
        <summary>すべての記録の現在の版を一覧する（{rows.length}件）</summary>
        <RecordTable label="すべての記録の現在の版" empty="登録されている記録はありません。" columns={["記録", "種類", "現在の版"]}
          rows={rows.map((row) => ({ key: `${row.kind}:${row.key}`, cells: [row.label, row.kind, versionText(row.revision)] }))} />
      </details>
    </section>
  </div>;
}
