import type { RecoveryStatus } from "@/ideal/api/client";
import { StatusPill } from "@/ideal/ui/atoms";
import { labelOf } from "../../shared/labels";

const STATE: Record<string, string> = { NO_RESTORE_RECORDED: "復元実行の記録なし", REPLAYED: "復元後の再反映が完了", QUARANTINED: "復元後の確認中（利用を止めています）" };
/** What each state means for the people who use the product, by the state code the server
 * returned (ops/erasure_replay.py sets REPLAYED once the erasures and use restrictions made
 * before the restore are applied to the restored data again; api/routers/planning.py
 * refuses every ordinary read until then). A state this table does not have says nothing. */
const MEANING: Record<string, string> = {
  NO_RESTORE_RECORDED: "バックアップからの復元は記録されていません。通常どおり利用できます。",
  REPLAYED: "バックアップから復元した後、復元より前に行った消去と利用停止を、復元したデータにもう一度反映し終えています。通常どおり利用できます。",
  QUARANTINED: "バックアップから復元した後、消去と利用停止をもう一度反映し終えるまで、通常の画面は利用できません。",
};
const TONE: Record<string, "good" | "warn"> = { NO_RESTORE_RECORDED: "good", REPLAYED: "good", QUARANTINED: "warn" };

/** The state of the restore target, read-only: the state as a word beside the title, that
 * nothing is restored from here, and the two facts the server returned. Restores are run by
 * operations, not here. A state this screen does not know is said to be unknown. */
export default function RecoveryView({ data: value }: { data: RecoveryStatus }) {
  return <section className="ideal-panel ideal-v3-measure" aria-labelledby="recovery-title">
    <div className="ideal-panel__head">
      <div><span className="ideal-eyebrow">バックアップからの復元</span><h2 id="recovery-title">復元先の状態</h2></div>
      <StatusPill tone={TONE[value.state] ?? "neutral"}>{labelOf(STATE, value.state)}</StatusPill>
    </div>
    <p className="ideal-v3-callout">表示だけの画面です。復元は運用の担当者が行います。この画面から復元を実行することはできません。</p>
    <dl className="ideal-definition-list">
      {Object.hasOwn(MEANING, value.state) && <div><dt>いまの状態</dt><dd>{MEANING[value.state]}</dd></div>}
      <div><dt>運用からの説明</dt><dd>{value.note}</dd></div>
      <div><dt>復元した日時・対象</dt><dd>この画面には表示されません。運用の記録で確認してください。</dd></div>
      <div><dt>再反映した記録の照合値</dt><dd>{value.manifest_hash ? <><code className="ideal-v3-governance-code">{value.manifest_hash}</code><br />運用の担当者が、復元の記録と照らし合わせるための値です。</> : "未記録"}</dd></div>
    </dl>
  </section>;
}
