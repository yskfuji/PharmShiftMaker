import type { RecoveryStatus } from "@/ideal/api/client";
import { StatusPill } from "@/ideal/ui/atoms";

const labels: Record<string, string> = { NO_RESTORE_RECORDED: "復元実行の記録なし", REPLAYED: "消去制御の再適用済み", QUARANTINED: "通常接続を遮断中" };

/** The state of the restore target, read-only. Restores are run by operations, not here. */
export default function RecoveryView({ data: value }: { data: RecoveryStatus }) {
  return <section className="ideal-panel" aria-labelledby="recovery-title"><span className="ideal-eyebrow">復旧後の照合</span><h2 id="recovery-title">復元先の状態</h2><div className="ideal-stack"><StatusPill tone={value.state === "QUARANTINED" ? "warn" : "good"}>{labels[value.state] ?? value.state}</StatusPill><dl className="ideal-definition-list"><div><dt>制御ハッシュ</dt><dd>{value.manifest_hash ?? "未記録"}</dd></div><div><dt>説明</dt><dd>{value.note}</dd></div></dl></div></section>;
}
