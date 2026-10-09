import type { ScopeSettings } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { jstText } from "../../shared/jst";
import type { RouteContext } from "../../shell/routeTypes";
import ConsentForm from "./ConsentForm";
import TableScrollCue from "../../shared/TableScrollCue";
import Identifiers from "../../shared/Identifiers";

/**
 * The absence consent switch of the scope. First the setting as it is now and what it means
 * for a replacement, then the form that changes it, then its history. Administrators are
 * offered the switch; the server decides who may use it. Who changed the setting is recorded
 * by the server as an account (not a role, and without a name): the table has no column for
 * it, and the accounts are shown, as the identifiers they are, where they are asked for.
 */
export default function AbsenceConsentView({ data, ctx }: { data: ScopeSettings; ctx: RouteContext }) {
  const consent = data.absence_replacement_consent;
  return <div className="ideal-stack">
    <section className="ideal-panel ideal-v3-measure" aria-labelledby="consent-title">
      <h2 id="consent-title">代わりに入る人の同意</h2>
      <div className="ideal-v3-callout ideal-v3-consent-state">
        <p className="ideal-v3-consent-state__now"><span>現在の設定</span><StatusPill tone={consent.enabled ? "good" : "neutral"}>{consent.enabled ? "同意を求める" : "同意を求めない"}</StatusPill></p>
        <p>{consent.enabled
          ? "欠勤の代わりに指名された人が同意してから、責任者が承認します。薬剤師も自分の勤務の代わりを指名できます。"
          : "責任者が代わりを決め、同意は求めません。薬剤師は代わりを指名できません。"}</p>
      </div>
      <div className="ideal-v3-record">
        <section>
          <h3 className="ideal-v3-heading">設定を切り替える</h3>
          <p className="ideal-note">切り替えは、切り替えた後に作るケースから適用されます（作成済みのケースは変わりません）。同じ操作で、いつでも元の設定に戻せます。</p>
          {ctx.role === "ADMIN" ? <ConsentForm enabled={consent.enabled} revision={consent.revision} /> : <p className="ideal-note">設定を切り替える操作は、管理者にだけ表示されます。</p>}
        </section>
        {consent.history && consent.history.length > 0 && <section>
          <h3 className="ideal-v3-heading">切り替えの履歴</h3>
          <TableScrollCue />
          <div className="ideal-table-wrap" role="region" aria-label="切り替えの履歴" tabIndex={0}><table className="ideal-table">
            <thead><tr><th scope="col">版</th><th scope="col">設定</th><th scope="col">理由</th><th scope="col">参照</th><th scope="col">日時（日本時間）</th></tr></thead>
            <tbody>{consent.history.map((h) => <tr key={h.revision}><th scope="row">第{h.revision}版</th><td>{h.enabled ? "同意を求める" : "同意を求めない"}</td><td data-verbatim>{h.reason}</td><td><code data-verbatim>{h.reference}</code></td><td>{jstText(h.at)}</td></tr>)}</tbody>
          </table></div>
          <Identifiers summary="変更したアカウント" items={consent.history.map((h) => ({ key: String(h.revision), label: `第${h.revision}版`, value: h.actor }))} />
        </section>}
      </div>
    </section>
  </div>;
}
