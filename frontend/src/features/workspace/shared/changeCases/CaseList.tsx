"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ScheduleChangeCase } from "@/ideal/types";
import { useLive } from "../../shell/WorkspaceRuntime";
import CaseActions from "./CaseActions";
import CaseSummary from "./CaseSummary";
import type { Verb } from "./cases";

/** The cases of a route and the one being decided. `verbs` is what the route offers for
 * each case. Which case is selected is the only state; it starts from the case the URL
 * names, and that case is looked for only in the list the server returned. */
export default function CaseList({ list, selectedCaseId, verbs }: { list: ScheduleChangeCase[]; selectedCaseId: string | null; verbs: Record<string, Verb[]> }) {
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(selectedCaseId);
  if (!list.length) return <p className="ideal-note">いま対応が必要なケースはありません。</p>;
  const current = list.find((item) => item.case_id === selected) ?? (selectedCaseId ? null : list[0]);
  if (!current) return <section className="ideal-note" role="alert"><h3>指定されたケースを表示できません</h3><p>この施設・部署で参照できないか、状態が変わりました。一覧から選び直してください。</p><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setSelected(list[0].case_id)}>一覧の先頭を開く</button></section>;
  return <div className="ideal-v3-master-detail ideal-v3-case-decision"><ul className="ideal-v3-master" aria-label="ケース一覧">{list.map((c) => <li key={c.case_id}><button type="button" aria-pressed={c.case_id === current.case_id} onClick={() => setSelected(c.case_id)}><span className={`ideal-dot ideal-dot--${c.kind === "ABSENCE" ? "warn" : "new"}`} /><span><strong>{c.kind === "ABSENCE" ? "欠勤" : "勤務交換"} · {c.status}</strong><small>版 {c.version} · {String((c.affected_assignments[0] as { start?: string } | undefined)?.start ?? "対象日時未確認")}</small></span><ChevronRight aria-hidden="true" /></button></li>)}</ul><article className="ideal-v3-detail" aria-live="polite"><span className="ideal-eyebrow">判断面 · ケース版 {current.version}</span><CaseSummary c={current} nameOf={live.nameOf} planner={live.role !== "PHARMACIST"} /><p className="ideal-note">承認すると既存版を上書きせず、新しい公開版を作り、関係者へ通知します。</p><CaseActions c={current} verbs={Object.hasOwn(verbs, current.case_id) ? verbs[current.case_id] : []} /></article></div>;
}
