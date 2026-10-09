"use client";

import RecordEditor from "../../shared/records/RecordEditor";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type DeclarationContext, type DeclarationPayload, type DeclarationSaved, type Piece } from "../api";
import DeclarationFields from "./DeclarationFields";
import { STATUS_LABEL, declarationFacts, declarationLabel, declarationNames, newDeclaration } from "./model";

export const NOBODY_NOTIFIED = "誰にも通知されません。保存後は、本人と管理者のこの画面の一覧に表示されます。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。";
export const declarationRisk = (revision: number) =>
  `保存前の時点では検出されていません。保存時にサーバーが、${revision > 0 ? `この申告が第${revision}版のままであること` : "この申告がまだ登録されていないこと"}を照合します。違っていれば保存せず、競合として知らせます。1件の申告だけを保存するため、一部だけが保存されることはありません。`;

const instant = (value: string) => new Date(value).toISOString();
const instants = (pieces: Piece[] | undefined) => (pieces ?? []).map((piece) => ({ start: instant(piece.start), end: instant(piece.end) }));
/** What a registration or a correction sends: the entered content as a submission, with
 * every time written as the same kind of instant whether it was typed now or stored before. */
const submission = (payload: DeclarationPayload): DeclarationPayload => ({
  ...payload, status: "SUBMITTED", review_evidence: null, start: instant(payload.start), end: instant(payload.end),
  scheduled_work: instants(payload.scheduled_work), additional_work: instants(payload.additional_work), other_holiday_work: instants(payload.other_holiday_work),
});

/**
 * Registers a declaration or corrects one the server lets this viewer change. A
 * correction is sent as a new submission: it returns to "awaiting comparison" and drops
 * the review, which the confirmation states before anything is sent.
 */
export default function DeclarationEditor({ context }: { context: DeclarationContext }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const names = declarationNames(context, live.nameOf);
  const open = context.declarations.filter((row) => row.actions.change.allowed);
  const closed = context.declarations.filter((row) => !row.actions.change.allowed);
  return <>
    <p className="ideal-note">新しく申告するときは、下の「編集する対象」で「新しい申告を登録する」を選びます。出してある申告を直すときは、その申告を選びます。直した申告は「照合待ち」に戻ります。</p>
    <RecordEditor<DeclarationPayload, DeclarationSaved>
      noun="申告" contentTitle="申告の内容を入力する" level={3}
      records={open.map((row) => ({ key: row.entity_id, revision: row.revision, payload: row.payload, label: declarationLabel(row, names) }))}
      create={() => newDeclaration(crypto.randomUUID(), live.personId)}
      facts={(payload) => declarationFacts(payload, names)}
      fields={(props) => <DeclarationFields {...props} employers={context.employers} establishments={context.establishments} />}
      prepare={submission}
      // An entry slip, not a judgement: the server refuses a period that does not run forward.
      slip={(payload) => (Date.parse(payload.start) >= Date.parse(payload.end) ? "適用終了は、適用開始より後にしてください。" : null)}
      mutation={(payload) => `record:outside_declaration:${payload.declaration_id}`}
      send={(body) => api.saveDeclaration(live.scopeId, body)}
      readCurrent={async (payload) => {
        const row = (await api.declarationContext(live.scopeId)).declarations.find((item) => item.entity_id === payload.declaration_id);
        return row ? { revision: row.revision, payload: row.payload } : null;
      }}
      notified={NOBODY_NOTIFIED}
      risk={declarationRisk}
      saved={(result) => `申告を第${result.revision}版として記録しました（${STATUS_LABEL[result.status] ?? result.status}）。`}
    />
    {closed.length > 0 && <ul role="list" className="ideal-note-list" aria-label="変更できない申告">{closed.map((row) => <li key={row.entity_id}>{declarationLabel(row, names)}：{row.actions.change.refusal}</li>)}</ul>}
    <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => void live.refresh()}>勤務先の候補と申告を読み直す</button></div>
  </>;
}
