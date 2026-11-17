"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { StatusPill } from "./shared";

// Synthetic content for the showcase; this screen is not wired to the API yet.
export default function PlanScreen() {
  const stages = ["前提確認", "候補生成", "案比較", "検証", "確認", "公開"];
  const [stage, setStage] = useState(2);
  return <div className="ideal-stack">
    <nav className="ideal-stepper" aria-label="計画の工程">{stages.map((name,i)=><button key={name} onClick={()=>setStage(i)} aria-current={stage===i ? "step" : undefined} className={stage===i ? "is-current" : i<stage ? "is-done" : ""}><span>{i<stage?<Check aria-hidden="true"/>:i+1}</span><strong>{name}</strong></button>)}</nav>
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">2026年11月 · 入力版 24</span><h2>{stages[stage]}</h2><p>承認済みの契約・資格・希望から生成した不変の入力です。</p></div><StatusPill tone="good">前提 14件確認済み</StatusPill></section>
    <div className="ideal-grid ideal-grid--plans">
      {[{n:"候補 A",score:"92",note:"勤務の一貫性を優先",recommended:true},{n:"候補 B",score:"88",note:"希望休の充足を優先",recommended:false},{n:"候補 C",score:"84",note:"夜勤の均等化を優先",recommended:false}].map((p,i)=><article className={`ideal-plan-card ${i===0?"is-selected":""}`} key={p.n}>{p.recommended&&<StatusPill tone="good">推奨</StatusPill>}<span className="ideal-eyebrow">{p.n}</span><div className="ideal-plan-card__score"><strong>{p.score}</strong><span>/ 100</span></div><p>{p.note}</p><dl><div><dt>必須条件</dt><dd>192 / 192</dd></div><div><dt>希望充足</dt><dd>{i===1?"94%":"91%"}</dd></div><div><dt>公開後変更予測</dt><dd>{i===0?"低":"中"}</dd></div></dl><button className={`ideal-button ${i===0?"ideal-button--primary":"ideal-button--secondary"}`}>{i===0?"選択中":"この案を選ぶ"}</button></article>)}
    </div>
    <section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">差分の根拠</span><h2>候補AとBの比較</h2></div><StatusPill tone="info">同一入力版</StatusPill></div><div className="ideal-comparison"><div><strong>6枠</strong><span>配置が異なる</span></div><div><strong>+3.2%</strong><span>Aの勤務一貫性</span></div><div><strong>−3件</strong><span>Aの希望充足</span></div></div><p className="ideal-note">スコアだけで公開は確定しません。差分、検証、影響する職員を確認して判断します。</p></section>
    <div className="ideal-stage-actions"><button className="ideal-button ideal-button--secondary" disabled={stage===0} onClick={()=>setStage(Math.max(0,stage-1))}>前へ</button><button className="ideal-button ideal-button--primary" onClick={()=>setStage(Math.min(5,stage+1))}>{stage===5?"公開内容を確認":"次へ"}<ArrowRight aria-hidden="true" /></button></div>
  </div>;
}
