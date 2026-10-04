import { Check, ChevronRight } from "lucide-react";
import { lifecycleCases } from "../data";
import { StatusPill } from "./shared";

// Synthetic content for the showcase; this screen is not wired to the API yet.
export default function PeopleScreen() {
  return <div className="ideal-stack">
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">職員ライフサイクル</span><h2>入職・契約・資格・退職</h2></div><button className="ideal-button ideal-button--primary">入職手続きを開始</button></section>
    <section className="ideal-panel">
      <div className="ideal-panel__head"><div><span className="ideal-eyebrow">進行中のケース</span><h2>タスクリスト</h2></div><StatusPill tone="info">履歴を保持</StatusPill></div>
      <div className="ideal-lifecycle-list">{lifecycleCases.map(item=><article key={item.caseId}>
        <span className={`ideal-avatar ${item.kind==="OFFBOARD"?"is-offboard":""}`}>{item.personName.slice(0,1)}</span>
        <div className="ideal-lifecycle-list__main"><div><strong>{item.personName}</strong><StatusPill tone={item.status==="COMPLETED"?"good":item.status==="READY"?"warn":"info"}>{item.kind==="ONBOARD"?"入職":"退職"} · {item.status==="COMPLETED"?"完了":item.status==="READY"?"確定待ち":"進行中"}</StatusPill></div><p>{item.effectiveDate} · {item.caseId}</p>
          <div className="ideal-progress" role="progressbar" aria-label={`${item.personName}のタスク進捗`} aria-valuemin={0} aria-valuemax={item.totalTasks} aria-valuenow={item.completedTasks}><span style={{width:`${item.completedTasks/item.totalTasks*100}%`}} /></div>
          <small>{item.completedTasks} / {item.totalTasks} タスク完了</small>
        </div>
        <button className="ideal-button ideal-button--secondary">開く <ChevronRight aria-hidden="true"/></button>
      </article>)}</div>
    </section>
    <section className="ideal-panel ideal-panel--quiet"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">山本 結衣 · LFC-208</span><h2>次のタスク</h2></div><StatusPill tone="warn">11月1日まで</StatusPill></div><ul className="ideal-task-list"><li className="is-done"><Check aria-hidden="true"/><span><strong>雇用契約を承認</strong><small>人事担当 · 9月26日</small></span></li><li className="is-done"><Check aria-hidden="true"/><span><strong>薬剤師免許を確認</strong><small>責任者 · 9月28日</small></span></li><li className="is-current"><span>5</span><span><strong>本人アカウントを紐付け</strong><small>issuer / subject と根拠を記録</small></span></li><li><span>6</span><span><strong>勤務候補を生成</strong><small>承認済み契約・資格から作成</small></span></li></ul></section>
  </div>;
}
