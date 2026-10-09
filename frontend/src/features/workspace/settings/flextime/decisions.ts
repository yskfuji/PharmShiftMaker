// What the confirmations of the flextime decisions say besides their content. Every step
// saves its record through the same path, which writes one audit event
// ("compliance.flex_adoption" or "compliance.flex_enrollment") that the notification list
// does not deliver to anybody.
export const NOBODY_NOTIFIED = "誰にも通知されません。操作後の状態は、管理者のこの画面の一覧に表示されます。操作の記録（操作した役割・版・時刻）は監査の履歴に残ります。";

/** What the server checks when a decision is recorded against `revision` of one record. */
export const decisionRisk = (noun: string, also = "") => (revision: number) =>
  `操作前の時点では検出されていません。操作時にサーバーが、この${noun}の記録が第${revision}版のままであることを照合します。違っていれば何も変更せず、競合として知らせます。${also}1回の処理で記録し、一部だけが反映されることはありません。`;
