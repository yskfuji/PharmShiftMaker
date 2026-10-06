import type { ReactNode } from "react";
import { jstText } from "../../shared/jst";
import type { CopyInventory, CopyTarget } from "../api";
import { blockersText, copyName, splitTargets } from "./model";
import Identifiers from "../../shared/Identifiers";

/**
 * What the server lists of one person's copies: the counts as a short list of facts, then
 * each copy as one marked line with where it is kept, the server's reasons it stays and its
 * retention deadline. Identifiers are a reveal of information, not a task. `each` adds what
 * a task offers for one copy.
 */
export default function InventoryList({ inventory, label, each }: { inventory: CopyInventory; label: string; each?: (target: CopyTarget, index: number) => ReactNode }) {
  const split = splitTargets(inventory);
  const controls = inventory.database_inventory?.control_records_remaining ?? [];
  return <div className="ideal-v3-record">
    <dl className="ideal-definition-list ideal-v3-governance-facts">
      <div><dt>登録コピー</dt><dd>{inventory.targets.length}件</dd></div>
      <div><dt>サーバーが処理の対象と答えたコピー</dt><dd>{split.stated ? `${split.processed.length}件` : "サーバーの回答にありません"}</dd></div>
      <div><dt>人物参照が未確認のコピー</dt><dd>{inventory.unverified_copies.length}件</dd></div>
      <div><dt>DBに残る本人記録</dt><dd>{inventory.database_records_remaining.length}件</dd></div>
      <div><dt>消去・保全・復元の制御記録</dt><dd>{controls.length}件（再作成の防止などに使う記録で、消去済みには数えません）</dd></div>
    </dl>
    {inventory.targets.length === 0 ? <p className="ideal-note">この職員の登録コピーは、サーバーの一覧にありません。</p> : <ul className="ideal-v3-governance-marked" aria-label={label}>{inventory.targets.map((target, index) => <li key={target.copy_id}>
      <strong>{copyName(target, index)}</strong>：残存理由 {blockersText(target)}{target.expires_at ? `／保存期限 ${jstText(target.expires_at)}` : ""}
      {each?.(target, index)}
    </li>)}</ul>}
    <Identifiers items={inventory.targets.map((target, index) => ({ key: target.copy_id, label: copyName(target, index), value: target.copy_id, note: `（第${target.revision}版）` }))}>
      {controls.length > 0 && <ul role="list" className="ideal-note-list" aria-label="制御記録の残存">{controls.map((record) => <li key={record.object}><code>{record.table}</code>：{record.purpose}。{record.reason}</li>)}</ul>}
    </Identifiers>
  </div>;
}
