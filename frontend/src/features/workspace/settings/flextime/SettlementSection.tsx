import { findingStatus, findingText } from "@/lib/findingText";
import type { Settlement } from "../api";
import { findingParts, hm, type SettlementState } from "./model";
import TableScrollCue from "../../shared/TableScrollCue";
import Identifiers from "../../shared/Identifiers";

/** The end of a settlement period is exclusive on the server; people read the last day. */
const lastDay = (end: string) => new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const monthly = (item: Settlement) => Object.values(item.monthly_overtime_seconds ?? {}).reduce((sum, seconds) => sum + seconds, 0);

/** The word before an identifier in a finding's sentence: what the record is (lib/findingText). */
const NAMED = /(雇用条件|採用|契約) $/;

/**
 * A finding's sentence for the screen. A record the sentence names is named there by the
 * key the system gave it (an employment's, an adoption's, a contract's), and the answer this
 * view reads holds no name for it (a finding is a status, a message and a rule; the people
 * of the settlement carry no employment keys). So the key is not part of the sentence on
 * screen: its place takes a reference mark (※1, ※2 … in the order the records are first
 * named; the same record keeps its mark), and the key stands with that mark in the
 * identifiers reveal under the findings. The words of the sentence are otherwise unchanged
 * (the spaces that set the key off from them go with it).
 */
function referenced(findings: Array<{ status: string; message: string }>) {
  const marks = new Map<string, { mark: number; word: string; identifier: string }>();
  const lines = findings.map((finding) => {
    const parts = findingParts(findingText(finding.message));
    return { status: finding.status, parts: parts.map((part, at) => {
      // The spaces that set a key off from the words around it go with the key.
      if (!part.identifier) {
        let text = part.text;
        if (parts[at + 1]?.identifier) text = text.replace(/ $/, "");
        if (parts[at - 1]?.identifier) text = text.replace(/^ /, "");
        return { text, mark: null };
      }
      const word = NAMED.exec(parts[at - 1]?.text ?? "")?.[1] ?? "記録";
      const key = `${word}\n${part.text}`;
      if (!marks.has(key)) marks.set(key, { mark: marks.size + 1, word, identifier: part.text });
      return { text: "", mark: marks.get(key)!.mark };
    }) };
  });
  return { lines, marks: Array.from(marks.values()) };
}

/**
 * The flextime settlement per person and settlement period, as the server computed it
 * from the registered input and the actuals. Read only: every number and every finding is
 * the server's; the findings are shown with its own text, as what needs attention. The
 * identifier of a record a finding names is in the reveal of identifiers, under its mark.
 */
export default function SettlementSection({ settlement }: { settlement: SettlementState | null }) {
  const result = settlement?.available ? settlement.result : null;
  const rows = result?.people.flatMap((person) => person.settlements.map((item) => ({ person, item }))) ?? [];
  const findings = referenced(result?.findings ?? []);
  return <section aria-labelledby="flextime-settlement-title">
    <h3 id="flextime-settlement-title" className="ideal-v3-heading">フレックスタイム制の清算</h3>
    <p className="ideal-note">実績の労働時間から、清算期間ごとに計算した結果です（時間:分）。この画面では変更できません。</p>
    {settlement === null && <p className="ideal-note">清算を読み込めませんでした。上の「一部の情報を更新できませんでした」を確認してください。</p>}
    {settlement && !settlement.available && <p className="ideal-note">清算は、まだ表示できません。サーバーの回答：{settlement.reason}</p>}
    {result && rows.length === 0 && <p className="ideal-note">清算の対象となる実績はまだありません。</p>}
    {result && rows.length > 0 && <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="職員別・清算期間別の清算" tabIndex={0}><table className="ideal-table">
      <thead><tr><th scope="col">職員</th><th scope="col">清算期間</th><th scope="col">総枠</th><th scope="col">実労働</th><th scope="col">各月の時間外（週平均50時間超）</th><th scope="col">最終月に加える時間外</th><th scope="col">割り当てられない時間外</th></tr></thead>
      <tbody>{rows.map(({ person, item }) => <tr key={person.person_id + item.kind + item.start}>
        <th scope="row">{person.name}</th>
        <td>{item.start} 〜 {lastDay(item.end)}{item.kind === "flextime_part" && "（途中入社・退職の部分）"}</td>
        <td>{hm(item.frame_seconds)}</td>
        <td>{hm(item.worked_seconds)}</td>
        <td>{item.kind === "flextime" ? hm(monthly(item)) : "—"}</td>
        <td>{item.kind === "flextime" ? hm(item.final_month_overtime_seconds ?? 0) : hm(item.settlement_seconds ?? 0)}</td>
        <td>{item.kind === "flextime" && item.unattributed_seconds ? hm(item.unattributed_seconds) : "—"}</td>
      </tr>)}</tbody>
    </table></div></>}
    {result && result.findings.length > 0 && <div className="ideal-v3-callout ideal-v3-callout--warn ideal-v3-flextime-findings">
      <h4 className="ideal-v3-heading">確認が必要な点</h4>
      <ul role="list" className="ideal-note-list" aria-label="清算で確認が必要な点">{findings.lines.map((finding, index) => <li key={index}>
        <strong>{findingStatus(finding.status)}</strong>：{finding.parts.map((part, at) => (part.mark === null ? part.text : <span key={at} className="ideal-v3-flextime-ref">（※{part.mark}）</span>))}
      </li>)}</ul>
      {findings.marks.length > 0 && <p className="ideal-note">※の付いた記録の識別子は、この下の「清算の識別情報」で確認できます。</p>}
    </div>}
    {result && (result.input_hash || findings.marks.length > 0) && <Identifiers summary="清算の識別情報" items={[
      ...findings.marks.map((item) => ({ key: `ref:${item.mark}`, label: `※${item.mark} ${item.word}の識別子`, value: item.identifier })),
      ...(result.input_hash ? [{ label: "計算に使った入力版", value: result.input_hash }] : []),
    ]} />}
  </section>;
}
