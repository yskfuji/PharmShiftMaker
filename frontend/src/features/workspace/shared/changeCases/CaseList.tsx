"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ScheduleChangeCase } from "@/ideal/types";
import { useLive } from "../../shell/WorkspaceRuntime";
import { whenText } from "../format";
import { caseStatusLabel } from "../labels";
import CaseActions from "./CaseActions";
import CaseSummary from "./CaseSummary";
import { involvedNames, ownDutiesText, type Verb } from "./cases";

/** The cases of a route and the one being decided. `verbs` is what the route offers for
 * each case. Which case is selected is the only state; it starts from the case the URL
 * names, and that case is looked for only in the list the server returned.
 *
 * A row is told from the others by its second line. A planner is given names, and the line
 * is whose duties the case moves, with the day of the first one after the version. A
 * pharmacist is not given other people's names (the server keeps them back), so for them
 * the line is their own duties in the case (what is removed and what is added, with day
 * and hours), and the day is not said a second time. */
export default function CaseList({ list, selectedCaseId, verbs }: { list: ScheduleChangeCase[]; selectedCaseId: string | null; verbs: Record<string, Verb[]> }) {
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(selectedCaseId);
  if (!list.length) return <p className="ideal-note">いま対応が必要なケースはありません。</p>;
  const offered = (c: ScheduleChangeCase): Verb[] => (Object.hasOwn(verbs, c.case_id) ? verbs[c.case_id] : []);
  const current = list.find((item) => item.case_id === selected) ?? (selectedCaseId ? null : list[0]);
  const rowLine = (c: ScheduleChangeCase) => {
    const own = live.role === "PHARMACIST" ? ownDutiesText(c, live.personId) : "";
    if (own) return <><small className="ideal-v3-case-who">あなたの勤務：{own}</small><small>第{c.version}版</small></>;
    const names = involvedNames(c, live.nameOf);
    return <>{names && <small className="ideal-v3-case-who">{names}</small>}<small>第{c.version}版 · {whenText((c.affected_assignments[0] as { start?: unknown } | undefined)?.start, "対象日時未確認")}</small></>;
  };
  if (!current) return <section className="ideal-note" role="alert"><h3>指定されたケースを表示できません</h3><p>この施設・部署で参照できないか、状態が変わりました。一覧から選び直してください。</p><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setSelected(list[0].case_id)}>一覧の先頭を開く</button></section>;
  return <div className="ideal-v3-master-detail ideal-v3-case-decision"><ul className="ideal-v3-master" aria-label="ケース一覧">{list.map((c) => <li key={c.case_id}><button type="button" aria-pressed={c.case_id === current.case_id} onClick={() => setSelected(c.case_id)}><span className={`ideal-dot ideal-dot--${c.kind === "ABSENCE" ? "warn" : "new"}`} /><span><strong>{c.kind === "ABSENCE" ? "欠勤" : "勤務交換"} · {caseStatusLabel(c.status)}</strong>{rowLine(c)}</span><ChevronRight aria-hidden="true" /></button></li>)}</ul><article className="ideal-v3-detail" aria-live="polite"><span className="ideal-eyebrow">選んだケースの内容（第{current.version}版）</span><CaseSummary c={current} nameOf={live.nameOf} planner={live.role !== "PHARMACIST"} />{offered(current).length === 0 && <p className="ideal-note">このケースで、いまこの画面からできる操作はありません。</p>}<CaseActions c={current} verbs={offered(current)} /></article></div>;
}
