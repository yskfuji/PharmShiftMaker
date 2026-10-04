import { LayoutDashboard, Moon, Sun } from "lucide-react";
import { StatusPill } from "./shared";

// Synthetic content for the showcase; this screen is not wired to the API yet.
export default function SettingsScreen() {
  return <div className="ideal-stack"><section className="ideal-toolbar"><div><span className="ideal-eyebrow">施設設定</span><h2>設定</h2></div><StatusPill tone="neutral">最終更新 9月30日</StatusPill></section><div className="ideal-grid ideal-grid--main"><section className="ideal-panel"><h2>表示と通知</h2><div className="ideal-form-row"><div><strong>表示テーマ</strong><span>端末設定を基準に切り替えます</span></div><div className="ideal-segmented"><button aria-pressed="false"><Sun aria-hidden="true"/>明</button><button aria-pressed="true"><LayoutDashboard aria-hidden="true"/>端末設定</button><button aria-pressed="false"><Moon aria-hidden="true"/>暗</button></div></div><div className="ideal-form-row"><div><strong>重要通知</strong><span>欠勤・交換・再公開を通知します</span></div><label className="ideal-switch"><input type="checkbox" defaultChecked/><span>有効</span></label></div></section><section className="ideal-panel ideal-panel--quiet"><span className="ideal-eyebrow">現在の対象</span><h2>東都医療センター 薬剤部</h2><dl className="ideal-definition"><div><dt>対象ID</dt><dd>scope-pharmacy-01</dd></div><div><dt>表示名</dt><dd>東都医療センター 薬剤部</dd></div><div><dt>タイムゾーン</dt><dd>Asia/Tokyo</dd></div></dl></section></div></div>;
}
