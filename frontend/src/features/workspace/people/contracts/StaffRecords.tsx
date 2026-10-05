"use client";

import { useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { regimeLabel, workingTimeSystemLabel } from "@/lib/regimeLabels";
import { useEnteredBeforeMount } from "../../shared/hydration";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { evidenceState } from "./CurrentRecords";
import { ENGAGEMENT, TIME_CATEGORY, employerName, ofPerson, periodText, siteName, versionText, type Roster } from "./model";
import RecordTable from "./RecordTable";
import { useSelectedPerson } from "./Selection";

/**
 * The people of the scope and, for the one chosen, the employment revisions, contracts
 * and qualifications registered for them. The search text is the only thing kept here;
 * the chosen person is the route's. Nothing is judged: each record is shown as registered.
 */
export default function StaffRecords({ roster }: { roster: Roster }) {
  const id = useId();
  const { personId, choose } = useSelectedPerson();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // Text typed into the search field of the server HTML raised no event here.
  useEnteredBeforeMount(search, (field) => setQuery((field as HTMLInputElement).value));
  if (!roster.people.length) return <p className="ideal-note">登録されている職員はいません。「次の操作」の「職員を登録・氏名を訂正する」から登録します。</p>;
  const wanted = query.trim().toLocaleLowerCase("ja-JP");
  const listed = roster.people.filter((item) => item.payload.name.toLocaleLowerCase("ja-JP").includes(wanted));
  const current = roster.people.find((item) => item.key === personId);
  const count = (records: Array<{ payload: { person_id: string } }>, person: string) => records.filter((item) => item.payload.person_id === person).length;
  return <div className="ideal-v3-master-detail">
    <div>
      <label className="ideal-field-label" htmlFor={`${id}-search`}>職員を検索</label>
      <input ref={search} id={`${id}-search`} type="search" className="ideal-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="氏名" />
      <p role="status">{listed.length}名を表示</p>
      <ul className="ideal-v3-master" aria-label="職員一覧">{listed.map((item) => <li key={item.key}>
        <button type="button" aria-pressed={item.key === personId} onClick={() => choose(item.key)}>
          <span className="ideal-avatar">{item.payload.name.slice(0, 1)}</span>
          <span><strong>{item.payload.name || "氏名未登録の職員"}</strong><small>雇用関係 {count(roster.employments, item.key)}件・契約 {count(roster.contracts, item.key)}件・資格 {count(roster.capabilities, item.key)}件</small></span>
          <ChevronRight aria-hidden="true" />
        </button>
      </li>)}</ul>
    </div>
    {current ? <article className="ideal-v3-detail" aria-live="polite">
      <span className="ideal-eyebrow">選択中の職員</span>
      <h4 className="ideal-v3-heading">{current.payload.name || "氏名未登録の職員"}（{versionText(current.revision)}）</h4>
      <div className="ideal-v3-record">
        <RecordTable label={`${current.payload.name}の雇用関係`} empty="登録されている雇用関係はありません。" columns={["雇用主・事業場", "適用期間（日本時間）", "労働時間制度", "兼業申告の確認", "版"]}
          rows={ofPerson(roster.employments, current.key).map((item) => ({ key: item.key, cells: [
            item.payload.establishment_id ? siteName(roster, item.payload.establishment_id) : employerName(roster, item.payload.employer_id), periodText(item.payload.start, item.payload.end),
            workingTimeSystemLabel(item.payload.working_time_system), evidenceState(item.payload.declaration), versionText(item.revision),
          ] }))} />
        <RecordTable label={`${current.payload.name}の契約`} empty="登録されている契約はありません。" columns={["雇用主", "適用期間（日本時間）", "雇用・勤務区分", "制度", "原本確認", "制度の根拠", "版"]}
          rows={ofPerson(roster.contracts, current.key).map((item) => ({ key: item.key, cells: [
            employerName(roster, item.payload.employer_id), periodText(item.payload.start, item.payload.end), `${ENGAGEMENT[item.payload.engagement] ?? "未登録の区分"}・${TIME_CATEGORY[item.payload.time_category] ?? "未登録の区分"}`,
            regimeLabel(item.payload.regime), evidenceState(item.payload.evidence), evidenceState(item.payload.regime_evidence), versionText(item.revision),
          ] }))} />
        <RecordTable label={`${current.payload.name}の資格`} empty="登録されている資格はありません。" columns={["業務（場所）", "適用期間（日本時間）", "監督", "原本確認", "版"]}
          rows={ofPerson(roster.capabilities, current.key).map((item) => ({ key: item.key, cells: [
            `${item.payload.task}（${item.payload.location}）`, periodText(item.payload.start, item.payload.end),
            item.payload.supervision_required ? "監督者の配置が必要" : `監督者は不要（監督できる人数 ${item.payload.supervisor_capacity}名）`, evidenceState(item.payload.evidence), versionText(item.revision),
          ] }))} />
      </div>
      <details className="ideal-v3-disclosure"><summary>識別情報</summary><p className="ideal-note">職員の識別子：{current.key}</p></details>
      <nav aria-label="選択職員の詳細">
        <WorkspaceLink route={routeOf("people/memberships").route} context={{ person: personId }}>本人アカウント</WorkspaceLink>
        <WorkspaceLink route={routeOf("people/lifecycle").route} context={{ person: personId }}>入職・退職</WorkspaceLink>
      </nav>
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => choose("")}>職員の選択を解除する</button></div>
    </article> : <div className="ideal-v3-detail" aria-live="polite">
      {personId
        ? <p className="ideal-note" role="alert">指定された職員は、現在の入力版と記録にありません。職員一覧から選び直してください。</p>
        : <p className="ideal-note">職員を選ぶと、その職員の雇用関係・契約・資格を表示し、「次の操作」の手順と記録をその職員に絞ります。</p>}
    </div>}
  </div>;
}
