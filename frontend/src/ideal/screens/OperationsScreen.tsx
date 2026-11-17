"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, UserRoundCheck } from "lucide-react";
import { StatusPill, Metric } from "./shared";

// Synthetic content for the showcase; this screen is not wired to the API yet.
export default function OperationsScreen() {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="ideal-stack">
    <div className="ideal-grid ideal-grid--4"><Metric label="勤務中" value="21名" detail="予定どおり" tone="good"/><Metric label="当日欠勤" value={confirmed?"0名":"1名"} detail={confirmed?"代替確定済み":"対応中"} tone={confirmed?"good":"danger"}/><Metric label="配置注意" value="1箇所" detail="注射室 15時以降" tone="warn"/><Metric label="未達通知" value="0件" detail="全員に配信済み"/></div>
    <section className="ideal-incident"><div className="ideal-incident__rail"><CircleAlert aria-hidden="true"/><span>優先対応</span></div><div className="ideal-incident__body"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">CHG-1048 · 欠勤</span><h2>高橋 葵さん · 10月14日 日勤</h2></div><StatusPill tone={confirmed?"good":"danger"}>{confirmed?"代替確定":"未確定"}</StatusPill></div><p>本人から8:06に連絡。公開版 v12 は保持されたままです。確定すると新しい公開版 v13を作成し、影響する職員へ通知します。</p><h3>代替候補</h3><div className="ideal-candidate is-best"><span className="ideal-avatar">渡</span><div><strong id="candidate-watanabe">渡辺 莉子</strong><span>必要資格あり · 休息 15時間 · 今月残業見込 +1.5h</span></div><StatusPill tone="good">全条件を通過</StatusPill><label className="ideal-choice"><input aria-labelledby="candidate-watanabe" type="radio" name="candidate" defaultChecked /></label></div><div className="ideal-candidate"><span className="ideal-avatar">加</span><div><strong id="candidate-kato">加藤 直樹</strong><span>必要資格あり · 連続勤務 5日目</span></div><StatusPill tone="warn">負荷に注意</StatusPill><label className="ideal-choice"><input aria-labelledby="candidate-kato" type="radio" name="candidate" /></label></div><div className="ideal-checkline"><CheckCircle2 aria-hidden="true"/><span>法定休息・資格・最低配置・希望休をサーバーで再検証済み</span><strong>8:14</strong></div><div className="ideal-actions"><button className="ideal-button ideal-button--primary" onClick={()=>setConfirmed(true)} disabled={confirmed}><UserRoundCheck aria-hidden="true"/>{confirmed?"新しい公開版 v13を作成しました":"渡辺さんで確定し通知"}</button><button className="ideal-button ideal-button--secondary">別の対応を記録</button></div></div></section>
  </div>;
}
