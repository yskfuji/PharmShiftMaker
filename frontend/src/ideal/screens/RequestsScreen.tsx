import { ChevronRight } from "lucide-react";
import { changeCases } from "../data";
import type { IdealRole } from "../types";
import { StatusPill, Metric } from "./shared";

// Synthetic content for the showcase; this screen is not wired to the API yet.
export default function RequestsScreen({ role }: { role: IdealRole }) {
  return <div className="ideal-stack"><section className="ideal-toolbar"><div><span className="ideal-eyebrow">残高・予約・取得を分離して表示</span><h2>{role==="PHARMACIST"?"自分の申請":"申請と勤務交換"}</h2></div><button className="ideal-button ideal-button--primary">新しい申請</button></section><div className="ideal-grid ideal-grid--3"><Metric label="利用可能残高" value="11.5日" detail="確定済み残高" tone="good"/><Metric label="予約済み" value="2日" detail="10月・11月 各1日"/><Metric label="今年の実取得" value="7日" detail="取得日ベース"/></div><section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">進行中</span><h2>判断と同意の流れ</h2></div><StatusPill tone="warn">2件</StatusPill></div><div className="ideal-case-list">{changeCases.slice(0,2).map(c=><article key={c.caseId}><div><StatusPill tone={c.kind==="ABSENCE"?"danger":"info"}>{c.kind==="ABSENCE"?"欠勤":"交換"}</StatusPill><small>{c.caseId} · 版{c.version}</small></div><h3>{c.summary}</h3><p>{c.kind==="SWAP"?"依頼者が申請 → 相手の同意待ち → 責任者判断":"本人連絡 → 代替候補選定 → 責任者確定"}</p><button className="ideal-link">内容を確認 <ChevronRight aria-hidden="true"/></button></article>)}</div></section></div>;
}
