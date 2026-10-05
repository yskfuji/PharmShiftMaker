import { stamp } from "@/ideal/live/format";
import type { ScopeSettings } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import type { RouteContext } from "../../shell/routeTypes";
import ConsentForm from "./ConsentForm";

/** The absence consent switch of the scope: its state, what it means and its history.
 * Administrators are offered the switch; the server decides who may use it. */
export default function AbsenceConsentView({ data, ctx }: { data: ScopeSettings; ctx: RouteContext }) {
  const consent = data.absence_replacement_consent;
  return <div className="ideal-stack">
    <section className="ideal-panel" aria-labelledby="consent-title">
      <div className="ideal-panel__head"><div><span className="ideal-eyebrow">欠勤の運用</span><h2 id="consent-title">代わりに入る人の同意</h2></div>
        <StatusPill tone={consent.enabled ? "good" : "neutral"}>{consent.enabled ? "同意を求める" : "同意を求めない"}</StatusPill></div>
      <p>{consent.enabled
        ? "欠勤の代わりに指名された人が同意してから、責任者が承認します。薬剤師も自分の勤務の代わりを指名できます。"
        : "責任者が代わりを決め、同意は求めません。薬剤師は代わりを指名できません。"}
        切り替えは、切り替えた後に作るケースから適用されます（作成済みのケースは変わりません）。</p>
      {ctx.role === "ADMIN" && <ConsentForm enabled={consent.enabled} revision={consent.revision} />}
      {consent.history && consent.history.length > 0 && <div className="ideal-table-wrap" role="region" aria-label="切り替えの履歴" tabIndex={0}><table className="ideal-table">
        <thead><tr><th scope="col">版</th><th scope="col">設定</th><th scope="col">理由</th><th scope="col">参照</th><th scope="col">変更者</th><th scope="col">日時</th></tr></thead>
        <tbody>{consent.history.map((h) => <tr key={h.revision}><td>{h.revision}</td><td>{h.enabled ? "同意を求める" : "求めない"}</td><td>{h.reason}</td><td>{h.reference}</td><td>{h.actor}</td><td>{stamp(h.at)}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
