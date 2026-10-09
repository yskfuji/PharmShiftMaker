// What the confirmation of a compliance record's save says besides its content. Every such
// save writes one audit event ("compliance.<kind>") that the notification list does not
// deliver to anybody.
export const RECORD_SAVE_NOTICE = "誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。";

/** What the server checks when one record is saved against `revision` (0: not registered yet). */
export const recordRisk = (noun: string) => (revision: number) =>
  `保存前の時点では検出されていません。保存時にサーバーが、${revision > 0 ? `この${noun}が第${revision}版のままであること` : `この${noun}がまだ登録されていないこと`}を照合します。違っていれば保存せず、競合として知らせます。1件の記録だけを保存するため、一部だけが保存されることはありません。`;
